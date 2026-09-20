import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HangStudio } from '@/components/editor/HangStudio';
import { ImageStudio } from '@/components/editor/ImageStudio';
import { PanelHost } from '@/components/editor/PanelHost';
import { RemixGraphModal } from '@/components/editor/RemixGraphModal';
import { Timeline } from '@/components/editor/Timeline';
import { Toolbar } from '@/components/editor/Toolbar';
import { TransportBar } from '@/components/editor/TransportBar';
import { AudioLayer } from '@/components/preview/AudioLayer';
import { PreviewSurface } from '@/components/preview/PreviewSurface';
import { accentGradient, aspectRatios, palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { myMembership, type CollabRole } from '@/lib/collab';
import { prewarmProxies } from '@/lib/proxy';
import { loadEvents, loadProject, recordAutoVersion, saveEvents, saveProject } from '@/lib/storage';
import { backupProjectToCloud, pullProject } from '@/lib/cloudSync';
import { findAutoRelinkPairs, findMissingMedia, pickRelinkPairs } from '@/lib/videdFile';
import type { MissingMedia } from '@/lib/videdFile';
import { indexProjectVision } from '@/lib/visionSearch';
import { selectPanelVisible, useEditorStore, type PanelId } from '@/store/editorStore';

const AUTOSAVE_MS = 800;

/** A bal oldali eszköz-rail elemei (medium/expanded elrendezésben). */
const RAIL_ITEMS = [
  { icon: 'sparkles-outline', panel: 'assistant' },
  { icon: 'server-outline', panel: 'library' },
  { icon: 'musical-notes-outline', panel: 'audio' },
  { icon: 'chatbox-ellipses-outline', panel: 'captions' },
  { icon: 'reader-outline', panel: 'transcript' },
  { icon: 'happy-outline', panel: 'sticker' },
  { icon: 'share-outline', panel: 'export' },
] as const;

export default function EditorScreen() {
  const { t } = useTranslation();
  const { id, panel } = useLocalSearchParams<{ id: string; panel?: string }>();
  const project = useEditorStore((s) => s.project);
  const dirty = useEditorStore((s) => s.dirty);
  const panelVisible = useEditorStore(selectPanelVisible);
  const activePanel = useEditorStore((s) => s.activePanel);
  const [missing, setMissing] = useState(false);
  const [missingMedia, setMissingMedia] = useState<MissingMedia[]>([]);
  const [relinking, setRelinking] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  const [collab, setCollab] = useState<{ ownerId: string; role: CollabRole } | null>(null);
  /** 🔍 a vision-index előmelegítő időzítője — projektváltáskor törlendő */
  const visionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 💾 mentés-állapot: bukott-e az utolsó autosave, és hányadik újrapróbánál tartunk
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const L = useLayout();

  usePlaybackClock();

  // 👥 megosztott projekt-e + a szerepem (a fejléc-jelzéshez / Studio-linkhez)
  useEffect(() => {
    if (project?.id === id) {
      myMembership(id).then(setCollab).catch(() => {});
    }
  }, [project?.id, id]);

  // 🤖 mély-link a szerkesztő egy paneljéhez (pl. a kezdőképernyő „AI eszközök"
  // füléből: ?panel=assistant) — a projekt betöltése után EGYSZER nyitjuk meg
  const panelOpenedRef = useRef(false);
  useEffect(() => {
    if (panelOpenedRef.current || !panel || project?.id !== id) {
      return;
    }
    // csak a kijelölés nélkül is nyitható (standalone) paneleket engedjük paramból
    const openable = new Set<PanelId>([
      'assistant',
      'export',
      'captions',
      'audio',
      'library',
      'transcript',
      'sticker',
      'imagedoc',
    ]);
    if (openable.has(panel as PanelId)) {
      useEditorStore.getState().setPanel(panel as PanelId);
      panelOpenedRef.current = true;
    }
  }, [panel, project?.id, id]);

  // projekt betöltése (ha nem ez van a store-ban)
  useEffect(() => {
    if (!id) {
      return;
    }
    const current = useEditorStore.getState().project;
    if (current?.id === id) {
      return;
    }
    // ⚠️ `alive` guard: a betöltés a GLOBÁLIS szerkesztő-store-t írja. Gyors
    // A→B→A projektváltásnál enélkül a későn beérkező (elavult) válasz felülírná
    // a frisset — rossz projekt jelenhetne meg a szerkesztőben.
    let alive = true;
    Promise.all([loadProject(id), loadEvents(id)])
      .then(([loaded, events]) => {
        if (!alive) {
          return;
        }
        if (loaded) {
          useEditorStore.getState().loadProject(loaded, events);
          // hiányzó média felismerése megnyitáskor (törölt/áthelyezett fájlok)
          if (Platform.OS !== 'web') {
            setMissingMedia(findMissingMedia(loaded));
            // 🔍 vision-index előmelegítés (P0‑8): a Smart Search első
            // keresése így azonnali — fájlonként cache-elt, hiba nem érdekes.
            // ⚠️ refben tartjuk: gyors ki-be lépésnél enélkül minden megnyitás
            // indított egy worker-feltöltéssel járó indexelést egy MÁR LEZÁRT
            // projektre (a cleanup törli).
            visionTimerRef.current = setTimeout(() => {
              indexProjectVision(loaded).catch(() => {});
            }, 4000);
          }
        } else {
          // 🗄️ helyileg hiányzik → próbáljuk a FELHŐBŐL (más eszköz / újratelepítés
          // után is megnyílik; login nélkül a catch a „hiányzó" ágra visz)
          pullProject(id)
            .then((cloud) => {
              if (!alive) {
                return;
              }
              if (cloud) {
                saveProject(cloud).catch(() => {}); // helyi visszaírás
                useEditorStore.getState().loadProject(cloud, events);
                if (Platform.OS !== 'web') {
                  setMissingMedia(findMissingMedia(cloud));
                }
              } else {
                setMissing(true);
              }
            })
            .catch(() => {
              if (alive) {
                setMissing(true);
              }
            });
        }
      })
      .catch(() => {
        if (alive) {
          setMissing(true);
        }
      });
    return () => {
      alive = false;
      if (visionTimerRef.current) {
        clearTimeout(visionTimerRef.current);
        visionTimerRef.current = null;
      }
    };
  }, [id]);

  /** Újracsatolás: előbb tartalom-egyezés alapján automatikusan, a maradékra kézi választó. */
  const relinkMissing = async () => {
    const state = useEditorStore.getState();
    if (!state.project || relinking) {
      return;
    }
    setRelinking(true);
    try {
      const auto = await findAutoRelinkPairs(state.project, missingMedia);
      for (const pair of auto) {
        state.dispatch({ type: 'RELINK_URI', oldUri: pair.oldUri, newUri: pair.newUri }, 'system');
      }
      let current = useEditorStore.getState().project;
      let remaining = current ? findMissingMedia(current) : [];
      if (remaining.length > 0) {
        const manual = await pickRelinkPairs(remaining);
        for (const pair of manual) {
          useEditorStore
            .getState()
            .dispatch({ type: 'RELINK_URI', oldUri: pair.oldUri, newUri: pair.newUri }, 'user');
        }
        current = useEditorStore.getState().project;
        remaining = current ? findMissingMedia(current) : [];
      }
      setMissingMedia(remaining);
    } finally {
      setRelinking(false);
    }
  };

  // némító kapcsolón is szóljon az előnézet
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  // vágási proxyk előmelegítése a projekt videóihoz (fire-and-forget)
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) {
      return;
    }
    const current = useEditorStore.getState().project;
    if (!current) {
      return;
    }
    prewarmProxies(
      current.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'video')
        .map((c) => c.uri)
    );
  }, [projectId]);

  // autosave: minden módosítás után rövid szünettel mentünk.
  // ⚠️ A mentés bukását NEM nyeljük el: a `saveAttempt` növelése újraindítja ezt
  // az effectet (a `dirty` és a `project` referencia ilyenkor változatlan, tehát
  // enélkül SOHA nem lenne újrapróbálkozás), a `saveFailed` pedig láthatóvá
  // teszi a felhasználónak, hogy a munkája nincs elmentve.
  useEffect(() => {
    if (!dirty || !project) {
      return;
    }
    // exponenciális visszalépés: 0,8 s → 1,6 s → 3,2 s … max 10 s
    const delay =
      saveAttempt === 0 ? AUTOSAVE_MS : Math.min(AUTOSAVE_MS * 2 ** saveAttempt, 10_000);
    const timer = setTimeout(() => {
      const state = useEditorStore.getState();
      if (!state.project || !state.dirty) {
        return;
      }
      const snap = state.project;
      Promise.all([saveProject(snap), saveEvents(snap.id, state.events)])
        .then(() => {
          state.markSaved();
          setSaveFailed(false);
          setSaveAttempt(0);
          // 🕓 autosave-előzmény (throttle-olt auto-verzió a történethez)
          recordAutoVersion(snap).catch(() => {});
          // 🗄️ INGYENES felhő-backup (best-effort) — a projekt userhez mentve, ne vesszen el
          backupProjectToCloud(snap);
        })
        .catch(() => {
          setSaveFailed(true);
          setSaveAttempt((n) => n + 1); // ← ez indítja az újrapróbálkozást
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [dirty, project, saveAttempt]);

  // kilépéskor végső mentés
  useEffect(() => {
    return () => {
      const state = useEditorStore.getState();
      if (state.project && state.dirty) {
        saveProject(state.project).catch(() => {});
        saveEvents(state.project.id, state.events).catch(() => {});
        backupProjectToCloud(state.project);
      }
      state.setPlaying(false);
      state.closeProject();
    };
  }, []);

  const cycleAspect = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const ids = aspectRatios.map((a) => a.id);
    const next = ids[(ids.indexOf(state.project.aspectRatio) + 1) % ids.length];
    state.dispatch({ type: 'SET_ASPECT', aspectRatio: next });
  };

  /**
   * Vissza: `router.back()` NEM csinál semmit, ha nincs előzmény (deep linkkel
   * vagy értesítésből nyitott szerkesztő) — ilyenkor a projektlistára lépünk,
   * hogy a gomb sose tűnjön halottnak. A kilépő-takarítás (mentés, lejátszás
   * leállítása, átmeneti módok nullázása) az unmount-effektben fut.
   */
  const goBack = () => {
    useEditorStore.getState().setPlaying(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (missing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.missing}>
          <Text style={styles.missingText}>{t('editorScreen.projectNotFound')}</Text>
          <Pressable onPress={goBack}>
            <Text style={styles.missingLink}>{t('common.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={goBack} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <View style={styles.headerTitleWrap}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {project?.name ?? '…'}
          {dirty ? ' •' : ''}
        </Text>
        {/* 💾 a mentés bukott — a felhasználó ne higgye, hogy a munkája biztonságban van */}
        {saveFailed ? (
          <Text style={styles.saveFailed} numberOfLines={1}>
            ⚠️ {t('editorScreen.saveFailed')}
          </Text>
        ) : null}
        {project?.remixOf ? (
          <Pressable
            onPress={() => setLineageOpen(true)}
            hitSlop={4}
            accessibilityRole="button"
          >
            <Text style={styles.remixOf} numberOfLines={1}>
              🔀 {t('editorScreen.remixedFrom', { name: project.remixOf.name })}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        <Pressable
          onPress={() =>
            router.push(`/collab/${id}${collab ? `?owner=${collab.ownerId}` : ''}`)
          }
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('collab.title')}
        >
          <Ionicons
            name={collab ? 'people' : 'people-outline'}
            size={22}
            color={collab ? palette.accent : palette.textDim}
          />
        </Pressable>
        <Pressable onPress={cycleAspect} hitSlop={8} style={styles.aspectButton}>
          <Text style={styles.aspectText}>{project?.aspectRatio ?? ''}</Text>
        </Pressable>
        <Pressable
          onPress={() => project && router.push(`/player/${project.id}`)}
          hitSlop={8}
        >
          <Ionicons name="play-circle-outline" size={24} color={palette.accent} />
        </Pressable>
        <Pressable
          onPress={() => useEditorStore.getState().setPanel('export')}
          hitSlop={8}
        >
          <LinearGradient
            colors={[...accentGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.exportButton}
          >
            <Ionicons name="share-outline" size={14} color="#fff" />
            <Text style={styles.exportButtonText}>Export</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );

  const missingBanner =
    missingMedia.length > 0 ? (
      <Pressable style={styles.missingBanner} onPress={relinkMissing}>
        <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
        <Text style={styles.missingBannerText}>
          {relinking
            ? t('editorScreen.relinking')
            : t('editorScreen.missingMedia', { count: missingMedia.length })}
        </Text>
      </Pressable>
    ) : null;

  // 👁️ néző szerep → csak olvasható (a felhő-mentést az RLS úgyis blokkolja)
  const collabBanner =
    collab?.role === 'viewer' ? (
      <Pressable
        style={styles.collabBanner}
        onPress={() => router.push(`/collab/${id}?owner=${collab.ownerId}`)}
      >
        <Ionicons name="eye-outline" size={16} color={palette.textDim} />
        <Text style={styles.collabBannerText}>{t('collab.viewerBanner')}</Text>
      </Pressable>
    ) : null;

  const rail = (
    <View
      style={[
        styles.toolRail,
        { width: L.editor.railWidth, paddingTop: L.spacing.sm, gap: L.spacing.xs },
      ]}
    >
      {RAIL_ITEMS.map((item) => {
        const active = activePanel === item.panel;
        const label = t('editorScreen.rail_' + item.panel);
        return (
          <Pressable
            key={item.panel}
            style={[
              styles.railItem,
              { width: L.editor.railWidth - 10, minHeight: L.touchMin },
              active ? styles.railItemActive : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() =>
              useEditorStore.getState().setPanel(active ? null : item.panel)
            }
          >
            <Ionicons
              name={item.icon}
              size={L.isExpanded ? 22 : 19}
              color={active ? '#fff' : palette.textDim}
            />
            <Text
              style={[
                styles.railLabel,
                { fontSize: L.font(9) },
                active ? styles.railLabelActive : null,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  /**
   * Három elrendezés, méret-osztály szerint (lásd `@/constants/layout`):
   *
   *  expanded — iPad fekvő/desktop. Teljes vágó-elrendezés: fejléc végig felül,
   *    alatta rail | előnézet+transport | DOKKOLT inspector, legalul teljes
   *    szélességű idővonal. A panel és az idővonal EGYSZERRE látszik.
   *  medium+fekvő — telefon fekvőben: kevés a magasság, ezért a vezérlők jobb
   *    oszlopba kerülnek, a videó kapja a bal oldalt.
   *  medium+álló — iPad állóban: rail + függőleges rakás, az idővonal VÉGIG
   *    látszik, a panel alulról jön fel fölé.
   *  compact — telefon állóban: az eredeti rakás, a panel az idővonal helyén.
   */
  let body: React.ReactNode;
  if (L.isExpanded) {
    body = (
      <>
        {header}
        {missingBanner}
        {collabBanner}
        <View style={styles.expandedBand}>
          {rail}
          <View style={styles.expandedCenter}>
            <PreviewSurface mode="edit" />
            <TransportBar />
          </View>
          {panelVisible ? (
            <View style={{ width: L.editor.inspectorWidth }}>
              <PanelHost variant="docked" />
            </View>
          ) : null}
        </View>
        <Timeline />
        <Toolbar />
      </>
    );
  } else if (L.sizeClass === 'medium' && L.isLandscape) {
    body = (
      <View style={styles.landscapeRow}>
        {rail}
        <View style={styles.landscapePreview}>
          <PreviewSurface mode="edit" />
        </View>
        <View style={styles.landscapeSide}>
          {header}
          {missingBanner}
        {collabBanner}
          <TransportBar />
          <View style={styles.landscapeSideBody}>
            {panelVisible ? <PanelHost /> : <Timeline />}
          </View>
          <Toolbar />
        </View>
      </View>
    );
  } else if (L.sizeClass === 'medium') {
    body = (
      <>
        {header}
        {missingBanner}
        {collabBanner}
        <View style={styles.expandedBand}>
          {rail}
          <View style={styles.expandedCenter}>
            <PreviewSurface mode="edit" />
            <TransportBar />
            <Timeline />
          </View>
        </View>
        {panelVisible ? <PanelHost /> : null}
        <Toolbar />
      </>
    );
  } else {
    body = (
      <>
        {header}
        {missingBanner}
        {collabBanner}
        <PreviewSurface mode="edit" />
        <TransportBar />
        {/* nyitott panel az idővonal helyén — így az előnézet kis kijelzőn sem zsugorodik el */}
        {panelVisible ? <PanelHost /> : <Timeline />}
        <Toolbar />
      </>
    );
  }

  return (
    // Fekvőben a notch / home-indicator az OLDALAKON van → ott a bal rail és az
    // előnézet a bevágás alá csúszna; ezért fekvő módban a bal/jobb szélt is
    // insetteljük. Állóban a bal/jobb inset 0, így ez nem változtat semmit.
    <SafeAreaView
      style={styles.container}
      edges={L.isLandscape ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        <AudioLayer />
      </KeyboardAvoidingView>
      <ImageStudio />
      <HangStudio />
      <RemixGraphModal
        visible={lineageOpen}
        onClose={() => setLineageOpen(false)}
        project={project}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  remixOf: {
    color: palette.accent,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  saveFailed: {
    color: palette.danger,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  aspectButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: palette.surfaceHigh,
  },
  aspectText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
  },
  landscapeRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // expanded/medium-álló középső sáv: rail | előnézet | (dokkolt inspector)
  expandedBand: {
    flex: 1,
    flexDirection: 'row',
  },
  expandedCenter: {
    flex: 1,
  },
  toolRail: {
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: palette.border,
    backgroundColor: palette.surface,
  },
  railItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: 10,
  },
  railItemActive: {
    backgroundColor: palette.accent,
  },
  railLabel: {
    color: palette.textDim,
    fontWeight: '700',
  },
  railLabelActive: {
    color: '#fff',
  },
  landscapePreview: {
    flex: 1,
  },
  landscapeSide: {
    width: '52%',
    maxWidth: 480,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
  },
  landscapeSideBody: {
    flex: 1,
  },
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.danger}1a`,
    borderWidth: 1,
    borderColor: `${palette.danger}55`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  missingBannerText: {
    flex: 1,
    color: palette.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  collabBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  collabBannerText: {
    flex: 1,
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  missingText: {
    color: palette.text,
    fontSize: 15,
  },
  missingLink: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
  },
});
