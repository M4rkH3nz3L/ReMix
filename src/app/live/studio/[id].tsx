import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { startLive } from '@/lib/live';
import {
  activeScene as getActiveScene,
  addDestination,
  addScene,
  addSource,
  removeScene,
  removeSource,
  reorderSource,
  setActiveScene,
  setTitle as setDocTitle,
  sortedSources,
  toggleDestination,
  toggleSourceVisible,
  updateSource,
} from '@/lib/liveDoc';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { LiveDoc, LivePlatform, LiveSource, LiveSourceKind, LiveTransform } from '@/types/live';

const SOURCE_ICON: Record<LiveSourceKind, keyof typeof Ionicons.glyphMap> = {
  camera: 'videocam',
  screen: 'desktop',
  image: 'image',
  video: 'film',
  text: 'text',
  shape: 'shapes',
  logo: 'ribbon',
  browser: 'globe',
};

const ADDABLE: LiveSourceKind[] = ['camera', 'screen', 'image', 'video', 'text', 'shape', 'logo', 'browser'];
const EXTERNAL_PLATFORMS: { platform: LivePlatform; label: string }[] = [
  { platform: 'youtube', label: 'YouTube' },
  { platform: 'tiktok', label: 'TikTok' },
  { platform: 'twitch', label: 'Twitch' },
  { platform: 'facebook', label: 'Facebook' },
  { platform: 'custom', label: 'RTMP' },
];

/** Vászon-arány a projekt aspectRatio-jából (szélesség:magasság). */
function aspectValue(ar: string | undefined): number {
  if (ar === '9:16') return 9 / 16;
  if (ar === '1:1') return 1;
  return 16 / 9;
}

/** Program-előnézet (SZERKESZTŐ mód): a jelenet forrásait 0–1 dobozokként rajzolja.
 *  Az élő videó-kompozíció a Fázis B (nézői PreviewSurface + data-channel). */
function LiveCanvas({
  doc,
  width,
  aspect,
  maxHeight,
  selectedId,
  onSelect,
}: {
  doc: LiveDoc;
  width: number;
  aspect: number;
  maxHeight: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const scene = getActiveScene(doc);
  // a 9:16 vászon túl magas lenne teljes szélességen → ha kell, a magasságra
  // korlátozzuk és a szélességet arányosan csökkentjük (középre igazítva).
  let w = width;
  let height = w / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    w = height * aspect;
  }
  return (
    <View style={[styles.canvas, { width: w, height }]}>
      {scene &&
        sortedSources(scene).map((src) => {
          const t = src.transform;
          const selected = src.id === selectedId;
          return (
            <Pressable
              key={src.id}
              onPress={() => onSelect(src.id)}
              style={[
                styles.srcBox,
                {
                  left: t.x * w,
                  top: t.y * height,
                  width: Math.max(28, t.w * w),
                  height: Math.max(22, t.h * height),
                  opacity: src.visible ? 1 : 0.35,
                  borderColor: selected ? palette.accent : '#ffffff55',
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              <Ionicons name={SOURCE_ICON[src.kind]} size={16} color="#fff" />
              <Text style={styles.srcBoxLabel} numberOfLines={1}>
                {src.label || src.kind}
              </Text>
            </Pressable>
          );
        })}
      {(!scene || scene.sources.length === 0) && (
        <View style={styles.canvasEmpty}>
          <Ionicons name="add-circle-outline" size={28} color={palette.textDim} />
          <Text style={styles.canvasEmptyText}>—</Text>
        </View>
      )}
    </View>
  );
}

/** Elrendezés-presetek a kijelölt forrásnak (drag helyett — OBS-szerű gyors layout). */
const LAYOUT_PRESETS: { key: string; icon: keyof typeof Ionicons.glyphMap; t: Partial<LiveTransform> }[] = [
  { key: 'full', icon: 'scan', t: { x: 0, y: 0, w: 1, h: 1 } },
  { key: 'left', icon: 'contract', t: { x: 0, y: 0, w: 0.5, h: 1 } },
  { key: 'right', icon: 'contract', t: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  { key: 'tl', icon: 'albums', t: { x: 0.04, y: 0.04, w: 0.3, h: 0.3 } },
  { key: 'tr', icon: 'albums', t: { x: 0.66, y: 0.04, w: 0.3, h: 0.3 } },
  { key: 'center', icon: 'tablet-portrait', t: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
];

export default function LiveStudioScreen() {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useEditorStore((s) => s.project);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasW, setCanvasW] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);

  // a projekt betöltése a közös store-ba (mint a többi stúdió-route)
  useEffect(() => {
    let active = true;
    Promise.all([loadProject(String(id)), loadEvents(String(id))])
      .then(([loaded, events]) => {
        if (!active) return;
        if (!loaded) {
          setLoadError(true);
          return;
        }
        useEditorStore.getState().loadProject(loaded, events);
        setTitleDraft(loaded.live?.title ?? loaded.name);
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [id]);

  const live = project?.live ?? null;

  const commit = useCallback((next: LiveDoc, label?: string) => {
    useEditorStore.getState().dispatch({ type: 'SET_LIVE_DOC', doc: next, label });
  }, []);

  const scene = useMemo(() => (live ? getActiveScene(live) : undefined), [live]);
  const selected: LiveSource | null = useMemo(
    () => scene?.sources.find((s) => s.id === selectedId) ?? null,
    [scene, selectedId]
  );

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={palette.border} />
          <Text style={styles.dim}>{t('common.error')}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryText}>{t('live.leave')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!project || !live) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const aspect = aspectValue(project.aspectRatio);

  const onAddSource = (kind: LiveSourceKind) => {
    if (!scene) return;
    const label = t(`live.studio.source.${kind}`, { defaultValue: kind });
    commit(addSource(live, scene.id, kind, () => makeId('lsrc'), { label }), `+ ${label}`);
    setAdding(false);
  };

  const onAddScene = () => {
    const next = addScene(live, `Scene ${live.scenes.length + 1}`, () => makeId('lscn'));
    const added = next.scenes[next.scenes.length - 1];
    commit(setActiveScene(next, added.id), '+ scene');
  };

  const onStart = async () => {
    const title = (titleDraft.trim() || live.title).slice(0, 120);
    setStarting(true);
    try {
      // 💾 a Studio-szerkesztések a store-ban élnek (nincs külön autosave-hook) →
      // mentjük, hogy a room a FRISS live-docot töltse (jelenetek/források/célok).
      const current = useEditorStore.getState().project;
      if (current) {
        await saveProject(current);
      }
      const session = await startLive(title);
      // 🎥 a room megkapja a live-projekt id-jét → a host betölti a live-docot és
      // broadcastolja a jelenet-állapotot (Fázis B: több-forrás kompozíció).
      router.replace(`/live/${session.id}?project=${id}`);
    } catch (e) {
      setStarting(false);
      Alert.alert(t('live.error', { defaultValue: 'Live' }), String((e as Error)?.message ?? e));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* fejléc */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <TextInput
          value={titleDraft}
          onChangeText={setTitleDraft}
          onEndEditing={() => commit(setDocTitle(live, titleDraft))}
          placeholder={t('live.titlePlaceholder', { defaultValue: "What's your live about?" })}
          placeholderTextColor={palette.textDim}
          style={styles.titleInput}
          maxLength={120}
        />
        <View style={styles.liveStudioBadge}>
          <Ionicons name="radio" size={13} color="#fff" />
          <Text style={styles.liveStudioBadgeText}>Studio</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* program-vászon */}
        <View style={styles.canvasWrap} onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)}>
          {canvasW > 0 && (
            <LiveCanvas
              doc={live}
              width={canvasW}
              aspect={aspect}
              maxHeight={winH * 0.42}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </View>

        {/* scene-strip */}
        <Text style={styles.sectionLabel}>{t('live.studio.scenes', { defaultValue: 'Scenes' })}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneStrip}>
          {live.scenes.map((s) => {
            const on = s.id === live.activeSceneId;
            return (
              <Pressable
                key={s.id}
                onPress={() => commit(setActiveScene(live, s.id))}
                onLongPress={() =>
                  live.scenes.length > 1 &&
                  Alert.alert(s.name, undefined, [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.delete'),
                      style: 'destructive',
                      onPress: () => commit(removeScene(live, s.id)),
                    },
                  ])
                }
                style={[styles.sceneChip, on && styles.sceneChipOn]}
              >
                <Text style={[styles.sceneChipText, on && styles.sceneChipTextOn]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.sceneChipCount}>{s.sources.length}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={onAddScene} style={[styles.sceneChip, styles.sceneChipAdd]}>
            <Ionicons name="add" size={18} color={palette.accent} />
          </Pressable>
        </ScrollView>

        {/* forrás-lista */}
        <View style={styles.rowBetween}>
          <Text style={styles.sectionLabel}>{t('live.studio.sources', { defaultValue: 'Sources' })}</Text>
          <Pressable onPress={() => setAdding((v) => !v)} style={styles.addSourceBtn} hitSlop={8}>
            <Ionicons name={adding ? 'close' : 'add'} size={16} color={palette.accent} />
            <Text style={styles.addSourceText}>{t('live.studio.addSource', { defaultValue: 'Source' })}</Text>
          </Pressable>
        </View>

        {adding && (
          <View style={styles.addGrid}>
            {ADDABLE.map((k) => (
              <Pressable key={k} onPress={() => onAddSource(k)} style={styles.addTile}>
                <Ionicons name={SOURCE_ICON[k]} size={20} color={palette.text} />
                <Text style={styles.addTileText}>{t(`live.studio.source.${k}`, { defaultValue: k })}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {scene &&
          sortedSources(scene)
            .slice()
            .reverse()
            .map((src) => {
              const sel = src.id === selectedId;
              return (
                <Pressable
                  key={src.id}
                  onPress={() => setSelectedId(sel ? null : src.id)}
                  style={[styles.srcRow, sel && styles.srcRowSel]}
                >
                  <Pressable onPress={() => commit(toggleSourceVisible(live, scene.id, src.id))} hitSlop={8}>
                    <Ionicons
                      name={src.visible ? 'eye' : 'eye-off'}
                      size={18}
                      color={src.visible ? palette.text : palette.textDim}
                    />
                  </Pressable>
                  <Ionicons name={SOURCE_ICON[src.kind]} size={16} color={palette.textDim} />
                  <Text style={styles.srcRowLabel} numberOfLines={1}>
                    {src.label || src.kind}
                  </Text>
                  <Pressable onPress={() => commit(reorderSource(live, scene.id, src.id, 'up'))} hitSlop={6}>
                    <Ionicons name="chevron-up" size={18} color={palette.textDim} />
                  </Pressable>
                  <Pressable onPress={() => commit(reorderSource(live, scene.id, src.id, 'down'))} hitSlop={6}>
                    <Ionicons name="chevron-down" size={18} color={palette.textDim} />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      commit(removeSource(live, scene.id, src.id));
                      if (selectedId === src.id) setSelectedId(null);
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="trash-outline" size={17} color={palette.danger} />
                  </Pressable>
                </Pressable>
              );
            })}

        {/* kijelölt forrás — gyors elrendezés */}
        {selected && scene && (
          <View style={styles.inspector}>
            <Text style={styles.inspectorTitle}>{selected.label || selected.kind}</Text>
            <View style={styles.presetRow}>
              {LAYOUT_PRESETS.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => commit(updateSource(live, scene.id, selected.id, { transform: p.t }))}
                  style={styles.presetBtn}
                >
                  <Ionicons name={p.icon} size={18} color={palette.text} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* célok */}
        <Text style={styles.sectionLabel}>{t('live.studio.destinations', { defaultValue: 'Destinations' })}</Text>
        <View style={styles.destRow}>
          {live.destinations.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => d.platform !== 'remix' && commit(toggleDestination(live, d.id))}
              style={[styles.destChip, d.enabled && styles.destChipOn, d.platform === 'remix' && styles.destChipLocked]}
            >
              <Text style={[styles.destChipText, d.enabled && styles.destChipTextOn]}>{d.label}</Text>
              {d.platform !== 'remix' && !d.enabled && (
                <Text style={styles.destPro}>Pro</Text>
              )}
            </Pressable>
          ))}
          {EXTERNAL_PLATFORMS.filter(
            (p) => !live.destinations.some((d) => d.platform === p.platform)
          ).map((p) => (
            <Pressable
              key={p.platform}
              onPress={() =>
                commit(addDestination(live, p.platform, p.label, () => makeId('ldst'), { enabled: true }))
              }
              style={[styles.destChip, styles.destChipAdd]}
            >
              <Ionicons name="add" size={14} color={palette.accent} />
              <Text style={styles.destChipText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>{t('live.studio.destHint', { defaultValue: 'ReMix feed is always on. External platforms are Pro (multistream).' })}</Text>
      </ScrollView>

      {/* akció-sáv */}
      <View style={styles.actionBar}>
        <Pressable onPress={onStart} disabled={starting} style={[styles.startBtn, starting && styles.startBtnDisabled]}>
          {starting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="radio" size={18} color="#fff" />
              <Text style={styles.startText}>{t('live.studio.startStreaming', { defaultValue: 'Start streaming' })}</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  dim: { color: palette.textDim, fontSize: 15, fontWeight: '700' },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  iconBtn: { padding: 2 },
  titleInput: { flex: 1, color: palette.text, fontSize: 16, fontWeight: '700' },
  liveStudioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveStudioBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  body: { padding: 12, gap: 12, paddingBottom: 24 },
  canvasWrap: { width: '100%' },
  canvas: { backgroundColor: '#000', borderRadius: 14, overflow: 'hidden', alignSelf: 'center' },
  srcBox: {
    position: 'absolute',
    backgroundColor: '#ffffff14',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  srcBoxLabel: { color: '#fff', fontSize: 10, fontWeight: '700' },
  canvasEmpty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  canvasEmptyText: { color: palette.textDim },

  sectionLabel: { color: palette.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  sceneStrip: { gap: 8, paddingVertical: 2 },
  sceneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    maxWidth: 160,
  },
  sceneChipOn: { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
  sceneChipText: { color: palette.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  sceneChipTextOn: { color: palette.accent },
  sceneChipCount: { color: palette.textDim, fontSize: 11, fontWeight: '800' },
  sceneChipAdd: { paddingHorizontal: 14 },

  addSourceBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addSourceText: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addTile: {
    width: '23%',
    aspectRatio: 1,
    backgroundColor: palette.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addTileText: { color: palette.text, fontSize: 11, fontWeight: '600' },

  srcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  srcRowSel: { borderColor: palette.accent },
  srcRowLabel: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },

  inspector: { backgroundColor: palette.surface, borderRadius: 12, padding: 12, gap: 10 },
  inspectorTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetBtn: {
    width: 44,
    height: 40,
    backgroundColor: palette.bg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  destRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  destChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  destChipOn: { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
  destChipLocked: { opacity: 0.9 },
  destChipAdd: { borderStyle: 'dashed', borderColor: palette.border },
  destChipText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  destChipTextOn: { color: palette.accent },
  destPro: { color: palette.textDim, fontSize: 10, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 17 },

  actionBar: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.danger,
    borderRadius: 14,
    paddingVertical: 15,
  },
  startBtnDisabled: { opacity: 0.6 },
  startText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  secondaryBtn: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: palette.text, fontSize: 14, fontWeight: '700' },
});
