import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ImageCropTool } from '@/components/editor/ImageCropTool';
import { ImageMarkupTool } from '@/components/editor/ImageMarkupTool';
import { type AdjustKey } from '@/constants/adjust';
import { palette } from '@/constants/editor';
import { adjustTintLayers } from '@/lib/adjustPreview';
import { bakeImage, persistToMedia, type ImageOp } from '@/lib/imageEditor';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, ClipAdjust, ImageClip } from '@/types/project';

const ADJUST_FIELDS: { key: AdjustKey; min: number; max: number }[] = [
  { key: 'brightness', min: -0.3, max: 0.3 },
  { key: 'contrast', min: -0.4, max: 0.4 },
  { key: 'saturation', min: -1, max: 1 },
  { key: 'temperature', min: -0.3, max: 0.3 },
];

type Tool = 'transform' | 'crop' | 'adjust' | 'draw';

const TOOLS: { id: Tool; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'transform', icon: 'sync-outline' },
  { id: 'crop', icon: 'crop-outline' },
  { id: 'adjust', icon: 'contrast-outline' },
  { id: 'draw', icon: 'brush-outline' },
];

/**
 * 🖼️ Kép Stúdió — teljes képernyős, MOBILRA optimalizált képszerkesztő.
 *
 * Minden művelet AZ ESZKÖZÖN fut (expo-image-manipulator / natív capture),
 * SEMMI nem megy a workerre. Szerkesztés közben a köztes eredmény a cache-ben
 * marad; a „Kész" gomb égeti tartós fájlba és teszi a klipre (undo-zható).
 *
 * A munkamenet-állapot a `ImageStudioSession`-ben él, `key={clip.id}`-vel — így
 * minden megnyitáskor tisztán, az adott klip eredeti képéről indul (nincs
 * állapot-visszaállító effekt).
 */
export function ImageStudio() {
  const clip = useEditorStore((s) => {
    if (!s.project || !s.imageStudioClipId) {
      return null;
    }
    for (const track of s.project.tracks) {
      const found = track.clips.find((c: Clip) => c.id === s.imageStudioClipId);
      if (found) {
        return found;
      }
    }
    return null;
  });
  const close = useEditorStore((s) => s.closeImageStudio);
  const open = clip?.kind === 'image';

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      {/* A Modal külön natív ablak: a gyökér SafeAreaProvider insetjei nem érnek
          ide, ezért saját provider kell — különben a felső sáv (Kész gomb) a
          Dynamic Island / akkumulátor alá csúszik (pl. iPhone 17 Pro Max). */}
      {open ? (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <ImageStudioSession key={clip.id} clip={clip} onClose={close} />
        </SafeAreaProvider>
      ) : null}
    </Modal>
  );
}

function ImageStudioSession({ clip, onClose }: { clip: ImageClip; onClose: () => void }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);

  // friss munkamenet minden megnyitáskor (a szülő key={clip.id}-vel remountol)
  const [workingUri, setWorkingUri] = useState(clip.uri);
  const [adjust, setAdjust] = useState<ClipAdjust>(clip.adjust ?? {});
  const [tool, setTool] = useState<Tool>('transform');
  const [busy, setBusy] = useState(false);

  // a geometria destruktív (új fájl), a korrekció nem-destruktív (klip.adjust) —
  // mindkettő ESZKÖZÖN: a tint-előnézet + a natív render bake-eli
  const geometryDirty = workingUri !== clip.uri;
  const adjustChanged = JSON.stringify(adjust) !== JSON.stringify(clip.adjust ?? {});
  const dirty = geometryDirty || adjustChanged;

  const applyOps = async (ops: ImageOp[]) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const baked = await bakeImage(workingUri, ops); // persist:false → cache
      setWorkingUri(baked.uri);
    } catch {
      Alert.alert(t('imageStudio.title'), t('imageStudio.bakeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onReset = () => {
    if (busy) {
      return;
    }
    setWorkingUri(clip.uri);
    setAdjust(clip.adjust ?? {});
  };

  const onDone = () => {
    if (busy) {
      return;
    }
    if (dirty) {
      const patch: Partial<ImageClip> = {};
      if (geometryDirty) {
        patch.uri = persistToMedia(workingUri); // cache → document/media
      }
      if (adjustChanged) {
        patch.adjust = adjust;
      }
      updateClip(clip.id, patch);
    }
    onClose();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* felső sáv */}
      <View style={styles.topBar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.topBtn} disabled={busy}>
          <Ionicons name="close" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('imageStudio.title')}</Text>
        <Pressable onPress={onReset} hitSlop={10} style={styles.topBtn} disabled={busy || !dirty}>
          <Text style={[styles.resetText, (!dirty || busy) && styles.dim]}>{t('common.reset')}</Text>
        </Pressable>
        <Pressable onPress={onDone} hitSlop={10} style={styles.doneBtn} disabled={busy}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </View>

      {tool === 'crop' ? (
        <ImageCropTool key={workingUri} uri={workingUri} busy={busy} onApplyOps={(ops) => applyOps(ops)} />
      ) : tool === 'draw' ? (
        <ImageMarkupTool key={workingUri} uri={workingUri} onApply={(u) => setWorkingUri(u)} />
      ) : (
        <>
          {/* előnézet */}
          <View style={styles.preview}>
            <Image
              source={{ uri: workingUri }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="none"
            />
            {adjustTintLayers(adjust).map((l, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={[styles.tint, { backgroundColor: l.color, opacity: l.opacity }]}
              />
            ))}
            {busy ? (
              <View style={styles.busy}>
                <ActivityIndicator color={palette.accent} />
              </View>
            ) : null}
          </View>

          {/* eszköz-tartalom */}
          <View style={styles.toolArea}>
            {tool === 'transform' ? (
              <View style={styles.transformRow}>
                <TransformButton
                  icon="arrow-undo-outline"
                  label={t('imageStudio.rotateLeft')}
                  onPress={() => applyOps([{ type: 'rotate', degrees: -90 }])}
                  disabled={busy}
                />
                <TransformButton
                  icon="arrow-redo-outline"
                  label={t('imageStudio.rotateRight')}
                  onPress={() => applyOps([{ type: 'rotate', degrees: 90 }])}
                  disabled={busy}
                />
                <TransformButton
                  icon="swap-horizontal-outline"
                  label={t('imageStudio.flipH')}
                  onPress={() => applyOps([{ type: 'flip', axis: 'horizontal' }])}
                  disabled={busy}
                />
                <TransformButton
                  icon="swap-vertical-outline"
                  label={t('imageStudio.flipV')}
                  onPress={() => applyOps([{ type: 'flip', axis: 'vertical' }])}
                  disabled={busy}
                />
              </View>
            ) : (
              <View style={styles.adjustCol}>
                {ADJUST_FIELDS.map((f) => (
                  <AdjustSlider
                    key={f.key}
                    label={t('imageStudio.adjust.' + f.key)}
                    value={adjust[f.key] ?? 0}
                    min={f.min}
                    max={f.max}
                    onChange={(v) => setAdjust((a) => ({ ...a, [f.key]: v }))}
                  />
                ))}
              </View>
            )}
          </View>
        </>
      )}

      {/* alsó eszköz-fülek */}
      <View style={styles.tabBar}>
        {TOOLS.map((tb) => {
          const active = tool === tb.id;
          return (
            <Pressable key={tb.id} onPress={() => setTool(tb.id)} style={styles.tab}>
              <Ionicons name={tb.icon} size={22} color={active ? palette.accent : palette.textDim} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t('imageStudio.tools.' + tb.id)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function TransformButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.tfBtn}>
      <Ionicons name={icon} size={24} color={palette.text} />
      <Text style={styles.tfLabel}>{label}</Text>
    </Pressable>
  );
}

/** Mobil, húzható csúszka egy szimmetrikus (−max…+max) korrekció-értékhez. */
function AdjustSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const trackRef = useRef(trackW);
  trackRef.current = trackW;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const rangeRef = useRef({ min, max });
  rangeRef.current = { min, max };
  const startRef = useRef(value);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = valueRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const { min: lo, max: hi } = rangeRef.current;
        const w = Math.max(1, trackRef.current - 22);
        const d = (g.dx / w) * (hi - lo);
        const v = Math.max(lo, Math.min(hi, startRef.current + d));
        cbRef.current(Math.round(v * 1000) / 1000);
      },
    })
  ).current;

  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const pct = Math.round((value / max) * 100);

  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderVal}>{pct > 0 ? `+${pct}` : pct}</Text>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.trackLine} />
        <View style={styles.trackCenter} />
        <View style={[styles.thumb, { left: frac * Math.max(0, trackW - 22) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topBtn: { padding: 4 },
  title: { flex: 1, color: palette.text, fontSize: 17, fontWeight: '700' },
  resetText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  dim: { color: palette.textDim },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  preview: {
    flex: 1,
    margin: 12,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { flex: 1, width: '100%' },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  toolArea: {
    minHeight: 96,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  transformRow: { flexDirection: 'row', justifyContent: 'space-around' },
  tfBtn: { alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  tfLabel: { color: palette.text, fontSize: 12, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingTop: 8,
    paddingBottom: 4,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { color: palette.textDim, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: palette.accent },
  tint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  adjustCol: { gap: 10, paddingVertical: 2 },
  sliderRow: { gap: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  sliderVal: { color: palette.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { height: 34, justifyContent: 'center' },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceHigh,
  },
  trackCenter: {
    position: 'absolute',
    left: '50%',
    width: 2,
    height: 12,
    marginLeft: -1,
    backgroundColor: palette.border,
  },
  thumb: {
    position: 'absolute',
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
