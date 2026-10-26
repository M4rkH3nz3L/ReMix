import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollabPresence } from '@/components/editor/CollabPresence';
import { SourceBin } from '@/components/SourceBin';
import { SourceSheet } from '@/components/SourceSheet';
import { ImageStudioModal } from '@/components/studio/image/ImageStudioModal';
import { AudioStudioModal } from '@/components/studio/audio/AudioStudioModal';
import { MiniTimeline } from '@/components/editor/MiniTimeline';
import { SelectionInfo } from '@/components/editor/SelectionInfo';
import { PanelHost } from '@/components/editor/PanelHost';
import { RemixGraphModal } from '@/components/editor/RemixGraphModal';
import { MissingMediaSheet } from '@/components/editor/MissingMediaSheet';
import { OverlayRasterHost } from '@/components/editor/OverlayRasterHost';
import { Timeline } from '@/components/editor/Timeline';
import { Toolbar } from '@/components/editor/Toolbar';
import { TransportBar } from '@/components/editor/TransportBar';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Toast } from '@/components/ui/Toast';
import { AudioLayer } from '@/components/preview/AudioLayer';
import { PreviewSurface } from '@/components/preview/PreviewSurface';
import { VodProcessingOverlay } from '@/components/editor/VodProcessingOverlay';
import { accentGradient, aspectRatios, palette } from '@/constants/editor';
import { useEditorKeyboard } from '@/hooks/useEditorKeyboard';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';
import { useLayout } from '@/hooks/useLayout';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { openProjectConversation } from '@/lib/chat';
import { currentUserId, ensureShared, myMembership, type CollabRole } from '@/lib/collab';
import { layoutBudget } from '@/lib/panelLayout';
import { isProjectEmpty } from '@/lib/projectUtils';
import { prewarmProxies } from '@/lib/proxy';
import { pruneProxyCache, pruneRenderCache } from '@/lib/cacheManager';
import { canCloudBackupMedia, projectMediaSafety } from '@/lib/storagePolicy';
import {
  clearRecovery,
  duplicateProject,
  isProjectTooLarge,
  loadEvents,
  loadProject,
  readRecovery,
  recordAutoVersion,
  recoveryIsFresher,
  saveProject,
  saveProjectAndEvents,
  writeRecovery,
} from '@/lib/storage';
import { backupProjectToCloud, pullProject } from '@/lib/cloudSync';
import { findAutoRelinkPairs, findMissingMedia, pickRelinkPairs, relinkCommandsFor } from '@/lib/videdFile';
import type { MissingMedia } from '@/lib/videdFile';
import { classifyMissingMedia, mediaRemoteMap, restoreMissingMedia } from '@/lib/mediaSync';
import type { Project } from '@/types/project';
import { useChat } from '@/store/chatStore';
import { useCollabLive } from '@/store/collabLiveStore';
import {
  selectPanelVisible,
  selectSurfaceTier,
  useEditorStore,
  type PanelId,
} from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';
import { useTutorial } from '@/store/tutorialStore';

const AUTOSAVE_MS = 800;

export default function EditorScreen() {
  const { t } = useTranslation();
  const { id, panel } = useLocalSearchParams<{ id: string; panel?: string }>();
  const project = useEditorStore((s) => s.project);
  const dirty = useEditorStore((s) => s.dirty);
  const tier = useEntitlement((s) => s.effectiveTier());
  const panelVisible = useEditorStore(selectPanelVisible);
  // 📐 MOBILE-UI §4: a panel felület-szintje + detentje → layout-költségvetés
  const surfaceTier = useEditorStore(selectSurfaceTier);
  const panelDetent = useEditorStore((s) => s.panelDetent);
  const [bodyH, setBodyH] = useState(0);
  const [timelineH, setTimelineH] = useState<number | undefined>(undefined);
  const [transportH, setTransportH] = useState<number | undefined>(undefined);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  // ⌨️ szöveg-szerkesztés: a billentyűzet fölött a lapnak hely kell → mini-idővonal
  const keyboardVisible = useKeyboardVisible();
  // a projekt-menü lezárulása UTÁN futó akció (lásd `menuAction`) — a korai return-ök ELÉ
  const pendingMenuAction = useRef<(() => void) | null>(null);
  const [missing, setMissing] = useState(false);
  const [missingMedia, setMissingMedia] = useState<MissingMedia[]>([]);
  const [relinking, setRelinking] = useState(false);
  // 📲 átviteli tár: van-e letölthető csomag ehhez a projekthez (B eszköz)
  const [transferSize, setTransferSize] = useState<number | null>(null);
  // 🩹 hiányzó-média per-fájl helyreállítás-lista (CORE §2.8)
  const [missingSheetOpen, setMissingSheetOpen] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  // 🗂️ üres-állapot onboarding → forrás-sheet megnyitása (telefonon, ahol nincs dokk)
  const [showSource, setShowSource] = useState(false);
  const [collab, setCollab] = useState<{ ownerId: string; role: CollabRole } | null>(null);

  // 💾 mentés-állapot: bukott-e az utolsó autosave, és hányadik újrapróbánál tartunk
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const L = useLayout();

  usePlaybackClock();
  useEditorKeyboard(); // ⌨️ web/tablet-billentyűzet → egységes parancskészlet (§2.7)

  // 👥 megosztott projekt-e + a szerepem (a fejléc-jelzéshez / Studio-linkhez)
  useEffect(() => {
    if (project?.id === id) {
      myMembership(id).then(setCollab).catch(() => {});
    }
  }, [project?.id, id]);

  // 👥 ÉLŐ collab: megosztott projektnél realtime csatorna (presence + parancs-szinkron).
  // A start() belül ellenőrzi a tagságot — nem megosztott projektnél no-op.
  useEffect(() => {
    const owner = collab?.ownerId;
    if (!owner || project?.id !== id) {
      return;
    }
    void useCollabLive.getState().start(id);
    // 👥 a saját lejátszófej broadcastja a többieknek (throttle ~150 ms — a playhead
    // ~60×/mp változik, de a kurzornak elég a ritkább frissítés)
    let last = 0;
    const unsubCursor = useEditorStore.subscribe((s, prev) => {
      if (s.playhead === prev.playhead) {
        return;
      }
      const now = Date.now();
      if (now - last < 150) {
        return;
      }
      last = now;
      useCollabLive.getState().sendCursor(s.playhead);
    });
    return () => {
      unsubCursor();
      useCollabLive.getState().stop();
    };
  }, [collab?.ownerId, id, project?.id]);

  // 📲 átviteli tár: ha van hiányzó média, megnézzük, vár-e ránk csomag (B eszköz)
  useEffect(() => {
    let alive = true;
    if (missingMedia.length === 0) {
      // a setState mikrotaszkban (react-hooks/set-state-in-effect)
      void Promise.resolve().then(() => {
        if (alive) {
          setTransferSize(null);
        }
      });
      return () => {
        alive = false;
      };
    }
    void import('@/lib/transferClient')
      .then((m) => m.fetchProjectTransfer(id))
      .then((meta) => {
        if (alive) {
          setTransferSize(meta && !meta.expired ? meta.sizeBytes : null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [missingMedia.length, id]);

  // 💬 projekt-szoba: MINDIG elérhető — a „nincs kollaboráció" csak annyit jelent,
  // hogy még nincs behívva senki. Tulajként az első megnyitás hozza létre a szobát
  // (tag-sor + felhő-terv), aztán a beszélgetés nyílik a chat-képernyőn.
  const openCollabChat = () => {
    const run = async () => {
      let owner = collab?.ownerId;
      if (!owner) {
        const me = currentUserId();
        const proj = useEditorStore.getState().project;
        if (!me || !proj || proj.id !== id) {
          return;
        }
        await ensureShared(proj);
        setCollab({ ownerId: me, role: 'owner' });
        owner = me;
      }
      const convId = await openProjectConversation(owner, id);
      void useChat.getState().loadInbox(); // a fejléc-cím/kind azonnal helyes legyen
      router.push(`/chat/${convId}`);
    };
    void run().catch(() => {});
  };

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
        // 🗄️ a hiányzó média AUTOMATIKUS visszaállítása a szerver-másolatból,
        // mielőtt a kézi „relink" bannert felkínálnánk — a fájlok nem vesznek el.
        const recoverMissingMedia = async (proj: Project) => {
          if (Platform.OS === 'web') {
            return;
          }
          if (findMissingMedia(proj).length === 0) {
            if (alive) {
              setMissingMedia([]);
            }
            return;
          }
          // remoteUrl-ök: a helyi assetből, vagy a felhő-projekt-másolatból
          let remoteByUri = mediaRemoteMap(proj);
          if (Object.keys(remoteByUri).length === 0) {
            const cloud = await pullProject(proj.id).catch(() => null);
            if (cloud) {
              remoteByUri = mediaRemoteMap(cloud);
            }
          }
          const { pairs } = await restoreMissingMedia(proj, remoteByUri);
          if (!alive) {
            return;
          }
          const store = useEditorStore.getState();
          // csak akkor relinkelünk, ha MÉG ez a projekt van betöltve (a user nem
          // váltott a több másodperces letöltés alatt)
          if (store.project?.id !== proj.id) {
            return;
          }
          // a relinket a COMMAND BUSON visszük a JELENLEGI projektre (egy undo-lépés):
          // így a letöltés alatt tett szerkesztések + az undo-előzmény/playhead
          // MEGMARADNAK — NEM full-reload (loadProject), ami mindezt nullázná.
          if (pairs.length > 0) {
            store.applyBatch(
              pairs.map((p) => ({ type: 'RELINK_URI' as const, oldUri: p.oldUri, newUri: p.newUri })),
              'system'
            );
            saveProject(useEditorStore.getState().project!).catch(() => {});
          }
          setMissingMedia(findMissingMedia(useEditorStore.getState().project!));
        };
        if (loaded) {
          useEditorStore.getState().loadProject(loaded, events);
          // 🛟 crash-recovery: ha van a mentettnél FRISSEBB pillanatkép (az előző
          // munkamenet nem fejezte be a mentést), felajánljuk a visszaállítást
          void readRecovery(id).then((rec) => {
            if (!alive || !rec || !recoveryIsFresher(rec.at, loaded.updatedAt)) {
              return;
            }
            if (useEditorStore.getState().project?.id !== id) {
              return;
            }
            Alert.alert(t('editor.recovery.title'), t('editor.recovery.message'), [
              {
                text: t('editor.recovery.discard'),
                style: 'cancel',
                onPress: () => void clearRecovery(id),
              },
              {
                text: t('editor.recovery.restore'),
                onPress: () => {
                  if (useEditorStore.getState().project?.id === id) {
                    useEditorStore.getState().restoreProject(rec.project);
                  }
                  void clearRecovery(id);
                },
              },
            ]);
          });
          // hiányzó média felismerése + automatikus visszaállítás a szerverről
          if (Platform.OS !== 'web') {
            void recoverMissingMedia(loaded);
            // 🔍 Az automatikus vision-index ELŐMELEGÍTÉS KIKAPCSOLVA (felhasználói
            // kérés: „az AI ne fusson"): a szerkesztő megnyitása ne indítson
            // magától AI/worker-indexelést. A Smart Search továbbra is elérhető —
            // az indexelést a keresés KÉZZEL indítja (AssistantPanel).
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
                  void recoverMissingMedia(cloud);
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
    };
  }, [id, t]);

  // 🗄️ Adatbiztonság: a szerkesztőből kilépve a projekt + a MÉDIA a szerverre kerül
  // (best-effort, idempotens — asset-enként egyszer tölt). Így eszközváltás vagy
  // újratelepítés után a betöltés vissza tudja állítani a fájlokat.
  useEffect(() => {
    return () => {
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        void backupProjectToCloud(p);
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
      // 🔗 ADR-012: a média-relink asset-centrikus (RELINK_ASSET), a shape-imageUri RELINK_URI
      for (const cmd of relinkCommandsFor(state.project, auto)) {
        state.dispatch(cmd, 'system');
      }
      let current = useEditorStore.getState().project;
      let remaining = current ? findMissingMedia(current) : [];
      if (remaining.length > 0) {
        const manual = await pickRelinkPairs(remaining);
        const proj = useEditorStore.getState().project;
        if (proj) {
          for (const cmd of relinkCommandsFor(proj, manual)) {
            useEditorStore.getState().dispatch(cmd, 'user');
          }
        }
        current = useEditorStore.getState().project;
        remaining = current ? findMissingMedia(current) : [];
      }
      setMissingMedia(remaining);
      if (remaining.length === 0) {
        setMissingSheetOpen(false);
      }
    } finally {
      setRelinking(false);
    }
  };

  /** 🩹 Per-fájl kézi újracsatolás (CORE §2.8): egyetlen hiányzó fájl relinkje —
   *  egy fájl bukása/hiánya nem akasztja a többit. A `relinkMissing` auto+kézi
   *  flow-ját tükrözi, de csak a kiválasztott elemre. */
  const relinkOne = async (item: MissingMedia) => {
    const state = useEditorStore.getState();
    if (!state.project || relinking) {
      return;
    }
    setRelinking(true);
    try {
      const pairs = await pickRelinkPairs([item]);
      const proj = useEditorStore.getState().project;
      if (proj && pairs.length > 0) {
        for (const cmd of relinkCommandsFor(proj, pairs)) {
          useEditorStore.getState().dispatch(cmd, 'user');
        }
      }
      const current = useEditorStore.getState().project;
      const remaining = current ? findMissingMedia(current) : [];
      setMissingMedia(remaining);
      if (remaining.length === 0) {
        setMissingSheetOpen(false);
      }
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
    // 🧹 a proxy lemez-cache budget-nyírása (06 §2.9): a legrégebbi proxykat
    // kiüríti, ha a mappa túlnőtt — halasztva, hogy a megnyitást ne blokkolja.
    const prune = setTimeout(() => {
      try {
        pruneProxyCache();
        pruneRenderCache(); // 🎬 a renderelt kimenetek (renders/) LRU-nyírása (VIDEOT §8)
      } catch {
        /* best-effort — a cache-nyírás sosem akaszthatja a szerkesztőt */
      }
    }, 3000);
    return () => clearTimeout(prune);
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
      // 🛟 a FŐ (atomi) mentés ELŐTT recovery-pillanatkép — ha a mentés elhasal vagy
      // az app meghal, a legutóbbi állapot megmarad, és a következő indításkor felajánljuk
      writeRecovery(snap, state.events);
      // ⚛️ ATOMI: projekt + index + események egy írásban (vagy mind, vagy semmi)
      saveProjectAndEvents(snap, state.events)
        .then(() => {
          state.markSaved();
          setSaveFailed(false);
          setSaveAttempt(0);
          clearRecovery(snap.id); // a munka biztonságban → a recovery-kulcs törölhető
          // 🕓 autosave-előzmény (throttle-olt auto-verzió a történethez)
          recordAutoVersion(snap).catch(() => {});
          // 🗄️ INGYENES felhő-backup (best-effort) — a projekt userhez mentve, ne vesszen el
          backupProjectToCloud(snap);
        })
        .catch(() => {
          setSaveFailed(true);
          setSaveAttempt((n) => n + 1); // ← újrapróbálkozás; a recovery MARAD (nem mentett munka)
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [dirty, project, saveAttempt]);

  // kilépéskor végső mentés
  useEffect(() => {
    return () => {
      const state = useEditorStore.getState();
      if (state.project && state.dirty) {
        const p = state.project;
        writeRecovery(p, state.events);
        saveProjectAndEvents(p, state.events).then(() => clearRecovery(p.id)).catch(() => {});
        backupProjectToCloud(p);
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
      // deep-linkkel/értesítésből nyitva nincs előzmény → a projektek listája (/studio)
      router.replace('/studio');
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

  // 💾 explicit „Mentés most" — az autosave mellé (az atomi mentést AZONNAL hívja)
  const saveNow = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const p = state.project;
    writeRecovery(p, state.events);
    saveProjectAndEvents(p, state.events)
      .then(() => {
        state.markSaved();
        setSaveFailed(false);
        setSaveAttempt(0);
        clearRecovery(p.id);
      })
      .catch(() => setSaveFailed(true));
  };

  // 🧬 „Mentés másként" — a jelenlegi mentése után egy MÁSOLAT, és ugrás rá
  const saveAsCopy = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const p = state.project;
    saveProjectAndEvents(p, state.events)
      .then(() => duplicateProject(p.id, t('editorScreen.copySuffix')))
      .then((copy) => {
        if (copy) {
          router.replace(`/editor/${copy.id}`);
        }
      })
      .catch(() => {});
  };

  // ⋯ projekt-menü lapként (nem Alert): telefonon ide költöznek a fejléc ritka
  // elemei is (képarány, közreműködők, bemutató) — az Android Alert max 3 gombot tud.
  const openProjectMenu = () => setProjectMenuOpen(true);
  // a menü-akció a lap TELJES lezárulása után fut (onDismissed): a bemutató/navigáció
  // új felületet nyit, ami iOS-en egy záródó Modal alatt elveszhetne
  const menuAction = (fn: () => void) => () => {
    pendingMenuAction.current = fn;
    setProjectMenuOpen(false);
  };
  const runPendingMenuAction = () => {
    const fn = pendingMenuAction.current;
    pendingMenuAction.current = null;
    fn?.();
  };
  const openCollabScreen = () =>
    router.push(`/collab/${id}${collab ? `?owner=${collab.ownerId}` : ''}`);
  const projectMenuItems: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
  }[] = [
    { icon: 'save-outline', label: t('editorScreen.saveNow'), onPress: menuAction(saveNow) },
    { icon: 'copy-outline', label: t('editorScreen.saveAsCopy'), onPress: menuAction(saveAsCopy) },
    ...(L.isCompact
      ? ([
          {
            icon: 'crop-outline',
            label: t('editorScreen.menuAspect', { aspect: project?.aspectRatio ?? '' }),
            onPress: cycleAspect,
          },
          { icon: 'people-outline', label: t('collab.title'), onPress: menuAction(openCollabScreen) },
          {
            icon: 'help-circle-outline',
            label: t('tutorial.launch'),
            onPress: menuAction(() => useTutorial.getState().openMenu()),
          },
        ] as const)
      : []),
  ];

  const header = (
    <View style={styles.header}>
      <Pressable onPress={goBack} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <View style={styles.headerTitleWrap}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {project?.name ?? '…'}
        </Text>
        {/* 💾 mentés-állapot: hiba esetén figyelmeztetés, egyébként Mentve/Mentés… */}
        {saveFailed ? (
          <Text style={styles.saveFailed} numberOfLines={1}>
            ⚠️ {t('editorScreen.saveFailed')}
          </Text>
        ) : (
          <Text style={styles.saveState} numberOfLines={1}>
            {dirty ? `● ${t('editorScreen.saving')}` : `✓ ${t('editorScreen.saved')}`}
          </Text>
        )}
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
        {/* 👥 élő résztvevők (realtime presence) — csak ha más is bent van */}
        <CollabPresence />
        {/* 💬 projekt-szoba — MINDIG elérhető (tulajként az első megnyitás hozza létre) */}
        <Pressable
          onPress={openCollabChat}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('chat.projectConversation')}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={21}
            color={collab ? palette.accent2 : palette.textDim}
          />
        </Pressable>
        {/* telefonon (compact) a ritka elemek — bemutató, közreműködők, képarány —
            a ⋯ projekt-menübe költöznek (MOBILE-UI §6.1): a fejléc egy sor marad */}
        {L.isCompact ? null : (
          <>
            {/* 🎓 interaktív bemutató indítása (felület-vezető) */}
            <Pressable
              onPress={() => useTutorial.getState().openMenu()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('tutorial.launch')}
            >
              <Ionicons name="help-circle-outline" size={22} color={palette.textDim} />
            </Pressable>
            <Pressable
              onPress={openCollabScreen}
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
          </>
        )}
        {/* ⋯ projekt-menü: Mentés most / Mentés másként (másolat) */}
        <Pressable
          onPress={openProjectMenu}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('editorScreen.projectMenuTitle')}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={palette.textDim} />
        </Pressable>
        {/* ▶️ a play-gomb a PREVIEW-ra került (PreviewSurface onOpenPlayer) — innen kivéve */}
        {/* Az EGYETLEN Export belépő (az alsó Toolbarból kivéve — nincs duplikáció).
            TutorialTarget: a felület-vezető export-lépése ide mutat. */}
        <TutorialTarget id="toolbar.export">
          <Pressable
            onPress={() => useEditorStore.getState().setPanel('export')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('editor.toolbar.export')}
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
        </TutorialTarget>
      </View>
    </View>
  );

  // 🩹 granuláris helyreállítás (CORE §2.8): a hiányzók közül hány ÁRVA (nincs
  // felhő-másolat → csak kézi relink segít) — a banner ezt külön jelzi, hogy a
  // felhasználó tudja, mire számítson a koppintás után.
  const orphanedCount =
    project && missingMedia.length > 0
      ? classifyMissingMedia(project, missingMedia, mediaRemoteMap(project)).orphaned.length
      : 0;
  const missingBanner =
    missingMedia.length > 0 ? (
      <Pressable style={styles.missingBanner} onPress={() => setMissingSheetOpen(true)}>
        <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
        <Text style={styles.missingBannerText}>
          {relinking
            ? t('editorScreen.relinking')
            : orphanedCount > 0
              ? t('editorScreen.missingMediaOrphaned', {
                  count: missingMedia.length,
                  orphaned: orphanedCount,
                })
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

  // 📦 túl nagy projekt → a mentés lassulhat; a ⋯-menüből duplikálható/szétszedhető
  const sizeBanner =
    project && isProjectTooLarge(project) ? (
      <Pressable style={styles.sizeBanner} onPress={openProjectMenu}>
        <Ionicons name="archive-outline" size={16} color={palette.warning} />
        <Text style={styles.sizeBannerText}>{t('editorScreen.sizeWarning')}</Text>
      </Pressable>
    ) : null;

  // 🗄️ ADR-013: FREE usernél a média CSAK az eszközön van (nincs auto felhő-mentés) →
  // proaktív adatvesztés-figyelmeztetés + Pro-ajánlat. (Pro usernél a média R2-n van.)
  const storageAtRisk =
    !!project && !canCloudBackupMedia(tier) && projectMediaSafety(project).atRisk;
  const storageSafetyBanner = storageAtRisk ? (
    <Pressable
      style={styles.storageBanner}
      onPress={() => usePaywall.getState().open('mediaBackup')}
    >
      <Ionicons name="cloud-offline-outline" size={16} color={palette.warning} />
      <Text style={styles.storageBannerText}>{t('editorScreen.freeMediaLocalWarning')}</Text>
      <Ionicons name="chevron-forward" size={14} color={palette.textDim} />
    </Pressable>
  ) : null;

  // 🎬 üres projekt → a fekete vászon helyett a forrás-mappához vezető onboarding.
  // Tableten a forrás-dokk látszik (odamutatunk); telefonon a kártya megnyitja a sheetet.
  const sourceDocked = L.editor.sourceBinWidth > 0;
  const emptyHint =
    project && isProjectEmpty(project) ? (
      <Pressable
        style={styles.emptyHint}
        onPress={sourceDocked ? undefined : () => setShowSource(true)}
        accessibilityRole={sourceDocked ? undefined : 'button'}
      >
        <Ionicons name="film-outline" size={22} color={palette.accent} />
        <View style={styles.emptyHintBody}>
          <Text style={styles.emptyHintTitle}>{t('editorScreen.emptyTitle')}</Text>
          <Text style={styles.emptyHintText}>
            {sourceDocked ? t('editorScreen.emptyHintDocked') : t('editorScreen.emptyHintSheet')}
          </Text>
        </View>
        {sourceDocked ? (
          <Ionicons name="arrow-back" size={18} color={palette.textDim} />
        ) : (
          <View style={styles.emptyHintCta}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.emptyHintCtaText}>{t('editorScreen.emptyCta')}</Text>
          </View>
        )}
      </Pressable>
    ) : null;

  /**
   * Elrendezés méret-osztály szerint (lásd `@/constants/layout`, MOBILE-UI §6–7):
   *
   *  expanded — iPad fekvő/desktop. Teljes vágó-elrendezés: fejléc végig felül,
   *    alatta bal eszköz-RAIL | előnézet+transport | DOKKOLT inspector, legalul
   *    teljes szélességű idővonal. A panel és az idővonal EGYSZERRE látszik.
   *  medium+fekvő — telefon fekvőben: a videó kapja a bal oldalt, a vezérlők a
   *    jobb oszlopba kerülnek; nyitott panelnél az idővonal MINI-sorrá húzódik
   *    (nem tűnik el), alatta a panel teljes oszlop-magasságban.
   *  medium+álló / compact — függőleges rakás a `layoutBudget` szerint (vászon-
   *    garancia): Strip az eszköztár helyén, inline detentes Sheet, Focusban a
   *    vászon a teljes body. iPad-állóban (`keepTimeline`) az idővonal teljes marad.
   */
  const budget = layoutBudget({
    bodyHeight: bodyH,
    tier: surfaceTier ?? 'none',
    detent: panelDetent,
    trackScale: L.editor.trackScale,
    timelineFullHeight: timelineH,
    transportHeight: transportH,
    keepTimeline: L.sizeClass === 'medium',
    keyboardVisible,
  });
  const focus = surfaceTier === 'focus';
  const banners = (
    <>
      {missingBanner}
      {collabBanner}
      {sizeBanner}
      {storageSafetyBanner}
      {emptyHint}
    </>
  );
  // a függőleges (telefon-álló / iPad-álló) rakás — a body-t MÉRJÜK, abból számol a budget
  const stackedWork = (
    <View style={styles.stackBody} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
      <PreviewSurface mode="edit" />
      {focus ? (
        // 🎯 Focus: a króm a vászon FÖLÉ úszik, minden más rejtve
        <PanelHost />
      ) : (
        <>
          <View onLayout={(e) => setTransportH(e.nativeEvent.layout.height)}>
            <TransportBar />
          </View>
          {budget.timelineMode === 'full' ? (
            <View onLayout={(e) => setTimelineH(e.nativeEvent.layout.height)}>
              <Timeline />
            </View>
          ) : budget.timelineMode === 'mini' ? (
            <MiniTimeline />
          ) : null}
          {surfaceTier === 'sheet' || surfaceTier === 'strip' ? (
            <PanelHost detents={budget.detents} />
          ) : null}
          {/* 🍞 a toast az eszköztár (vagy a lap) FÖLÖTT úszik — a horgony a rakás alja */}
          <View style={styles.toastAnchor}>
            <Toast />
            {budget.toolbarVisible ? <Toolbar /> : null}
          </View>
        </>
      )}
    </View>
  );

  let body: React.ReactNode;
  if (L.isExpanded) {
    body = (
      <>
        {header}
        {banners}
        <View style={styles.expandedBand}>
          {/* 🧰 bal eszköz-rail: az alsó eszköztár helyett (MOBILE-UI §7) — így a
              vászon és az idővonal magasságot nyer, az eszközök hüvelykujj-közelben */}
          <View style={{ width: L.editor.railWidth }}>
            <Toolbar variant="rail" />
          </View>
          {L.editor.sourceBinWidth > 0 ? (
            <View style={[styles.sourceDock, { width: L.editor.sourceBinWidth }]}>
              <SourceBin compact scroll onInsert={(a) => useEditorStore.getState().insertSourceAsset(a)} />
            </View>
          ) : null}
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
        <SelectionInfo />
        <Timeline />
        <View style={styles.toastAnchor}>
          <Toast />
        </View>
      </>
    );
  } else if (L.sizeClass === 'medium' && L.isLandscape) {
    body = (
      <View style={styles.landscapeRow}>
        <View style={styles.landscapePreview}>
          <PreviewSurface mode="edit" />
        </View>
        <View style={styles.landscapeSide}>
          {header}
          {banners}
          <TransportBar />
          <View style={styles.landscapeSideBody}>
            {panelVisible ? (
              <>
                {/* az idővonal NEM tűnik el: mini-sor; a ⌃ bezárja a panelt */}
                <MiniTimeline onExpand={() => useEditorStore.getState().setPanel(null)} />
                <PanelHost variant="docked" />
              </>
            ) : (
              <Timeline />
            )}
          </View>
          <View style={styles.toastAnchor}>
            <Toast />
            {panelVisible ? null : <Toolbar />}
          </View>
        </View>
      </View>
    );
  } else if (L.sizeClass === 'medium') {
    body = (
      <>
        {focus ? null : header}
        {focus ? null : banners}
        <View style={styles.expandedBand}>
          {L.editor.sourceBinWidth > 0 && !focus ? (
            <View style={[styles.sourceDock, { width: L.editor.sourceBinWidth }]}>
              <SourceBin compact scroll onInsert={(a) => useEditorStore.getState().insertSourceAsset(a)} />
            </View>
          ) : null}
          {stackedWork}
        </View>
      </>
    );
  } else {
    body = (
      <>
        {focus ? null : header}
        {focus ? null : banners}
        {stackedWork}
      </>
    );
  }

  return (
    // Fekvőben a notch / home-indicator az OLDALAKON van → ott az előnézet a
    // bevágás alá csúszna; ezért fekvő módban a bal/jobb szélt is insetteljük.
    // Állóban a bal/jobb inset 0, így ez nem változtat semmit.
    <SafeAreaView
      style={styles.container}
      edges={L.isLandscape ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        <BottomSheet
          visible={projectMenuOpen}
          onClose={() => setProjectMenuOpen(false)}
          onDismissed={runPendingMenuAction}
          accessibilityLabel={t('editorScreen.projectMenuTitle')}
        >
          <Text style={styles.menuTitle}>{t('editorScreen.projectMenuTitle')}</Text>
          {projectMenuItems.map((item) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              style={styles.menuRow}
              accessibilityRole="button"
            >
              <Ionicons name={item.icon} size={20} color={palette.text} />
              <Text style={styles.menuLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </BottomSheet>
        <AudioLayer />
      </KeyboardAvoidingView>
      <ImageStudioModal />
      <AudioStudioModal />
      <RemixGraphModal
        visible={lineageOpen}
        onClose={() => setLineageOpen(false)}
        project={project}
      />
      {showSource ? (
        <SourceSheet
          onInsert={(a) => {
            useEditorStore.getState().insertSourceAsset(a);
            setShowSource(false);
          }}
          onClose={() => setShowSource(false)}
        />
      ) : null}
      {missingSheetOpen && project && missingMedia.length > 0 ? (
        <MissingMediaSheet
          project={project}
          missing={missingMedia}
          relinking={relinking}
          transferSizeBytes={transferSize}
          onRestoreFromTransfer={() => {
            // 📲 átviteli tár: a másik eszközön feltöltött .rp letöltése + pontos pótlás
            const run = async () => {
              const proj = useEditorStore.getState().project;
              if (!proj) {
                return;
              }
              setRelinking(true);
              try {
                const res = await import('@/lib/transferClient').then((m) =>
                  m.restoreProjectFromTransfer(proj)
                );
                if (!res) {
                  setTransferSize(null); // lejárt/eltűnt — a gomb tűnjön el
                  Alert.alert(t('editor.missingSheet.title'), t('editor.missingSheet.transferGone'));
                  return;
                }
                const store = useEditorStore.getState();
                if (res.pairs.length > 0 && store.project?.id === proj.id) {
                  store.applyBatch(
                    res.pairs.map((p) => ({
                      type: 'RELINK_URI' as const,
                      oldUri: p.oldUri,
                      newUri: p.newUri,
                    })),
                    'system'
                  );
                }
                const remaining = findMissingMedia(useEditorStore.getState().project!);
                setMissingMedia(remaining);
                setTransferSize(null); // sikeres átvétel után a csomag törlődik
                if (remaining.length === 0) {
                  setMissingSheetOpen(false);
                }
                Alert.alert(
                  t('editor.missingSheet.title'),
                  t('editor.missingSheet.fromRpResult', {
                    count: res.pairs.length,
                    remaining: remaining.length,
                  })
                );
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
              } finally {
                setRelinking(false);
              }
            };
            void run();
          }}
          onRelinkAll={() => {
            void relinkMissing();
          }}
          onRelinkOne={(m) => {
            void relinkOne(m);
          }}
          onRestoreFromRp={() => {
            // 📲 felhő nélküli eszközváltás: a másik eszközről (AirDrop/Fájlok)
            // áthozott .rp csomagból PONT a hiányzók pótlódnak, undo-safe relinkkel
            const run = async () => {
              const proj = useEditorStore.getState().project;
              if (!proj) {
                return;
              }
              setRelinking(true);
              try {
                const res = await import('@/lib/rpFile').then((m) =>
                  m.pickAndRestoreMissingFromRp(proj)
                );
                if (!res) {
                  return; // mégse
                }
                const store = useEditorStore.getState();
                if (res.pairs.length > 0 && store.project?.id === proj.id) {
                  store.applyBatch(
                    res.pairs.map((p) => ({
                      type: 'RELINK_URI' as const,
                      oldUri: p.oldUri,
                      newUri: p.newUri,
                    })),
                    'system'
                  );
                }
                const remaining = findMissingMedia(useEditorStore.getState().project!);
                setMissingMedia(remaining);
                if (remaining.length === 0) {
                  setMissingSheetOpen(false);
                }
                Alert.alert(
                  t('editor.missingSheet.fromRp'),
                  t('editor.missingSheet.fromRpResult', {
                    count: res.pairs.length,
                    remaining: remaining.length,
                  })
                );
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
              } finally {
                setRelinking(false);
              }
            };
            void run();
          }}
          onClose={() => setMissingSheetOpen(false)}
        />
      ) : null}
      {/* 📸 overlay-raszter host: az eszközön-render szöveg-PNG-it a preview-
          komponens snapshotja adja (pixel-hű) — láthatatlan, csak renderkor él */}
      <OverlayRasterHost />
      {/* ⏳ live-VOD feldolgozás-loader: a legfelső réteg, amíg a felvétel elérhető nem lesz */}
      <VodProcessingOverlay />
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
  saveState: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '600',
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
  // expanded/medium-álló középső sáv: előnézet | (dokkolt inspector)
  expandedBand: {
    flex: 1,
    flexDirection: 'row',
  },
  expandedCenter: {
    flex: 1,
  },
  // 🗂️ mindig-látható dokkolt forrás-mappa (bal oszlop, tablet/fekvő)
  sourceDock: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.border,
  },
  // 📐 a függőleges rakás mért body-ja (a layoutBudget bemenete)
  stackBody: {
    flex: 1,
  },
  toastAnchor: {
    position: 'relative',
  },
  menuTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  menuLabel: {
    color: palette.text,
    fontSize: 15,
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
  sizeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.warning}1a`,
    borderWidth: 1,
    borderColor: `${palette.warning}55`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sizeBannerText: {
    flex: 1,
    color: palette.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  storageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.warning}14`,
    borderWidth: 1,
    borderColor: `${palette.warning}44`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  storageBannerText: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: `${palette.accent}55`,
    borderStyle: 'dashed',
    borderRadius: 14,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyHintBody: {
    flex: 1,
    gap: 2,
  },
  emptyHintTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyHintText: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyHintCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyHintCtaText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
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
