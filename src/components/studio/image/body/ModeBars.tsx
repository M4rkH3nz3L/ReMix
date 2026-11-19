import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { DEFAULT_GRID, GRID_SIZES } from '@/lib/imageGrid';
import type { NodeType } from '@/lib/vectorPath';
import type { ImageGrid } from '@/types/project';

/**
 * 🎯 A precíziós módok alsó sávjai (kivágás, toll, node-szerkesztő, lasszó, varázspálca, sarok-
 * perspektíva, vonalzók) — az eszköztár HELYETT jelennek meg. VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `ImageStudioBody`-ból: minden állapot és művelet propból jön (a dokumentum-írás a body-ban, a
 * command-buson), itt csak a gombok és a helyi preset-listák élnek.
 */

/** kivágás-arány presetek (pixel-arány w:h; null = szabad/teljes) */
const CROP_PRESETS: { label: string; labelKey?: string; ratio: number | null }[] = [
  { label: '', labelKey: 'studio.image.crop.free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

/** varázspálca-tűrés: mennyire eltérő színek tartoznak még a kijelölésbe */
const WAND_TOLERANCES = [
  { value: 16, labelKey: 'studio.image.wand.tight' },
  { value: 32, labelKey: 'studio.image.wand.normal' },
  { value: 64, labelKey: 'studio.image.wand.wide' },
];

/* ✂️ kivágás-sáv (crop-módban a toolbar HELYETT) */
export function CropBar({
  cropPreset,
  onPreset,
  onCancel,
  onApply,
}: {
  cropPreset: number | null;
  onPreset: (ratio: number | null) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={onCancel} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cropPresets}>
        {CROP_PRESETS.map((p) => (
          <Chip
            key={p.labelKey ?? p.label}
            label={p.labelKey ? t(p.labelKey) : p.label}
            active={cropPreset === p.ratio}
            onPress={() => onPreset(p.ratio)}
          />
        ))}
      </ScrollView>
      <Pressable onPress={onApply} style={styles.cropApply} hitSlop={6}>
        <Ionicons name="checkmark" size={16} color="#fff" />
        <Text maxFontSizeMultiplier={1.3} style={styles.cropApplyText}>{t('common.apply')}</Text>
      </Pressable>
    </View>
  );
}

/* ✏️ toll-sáv (toll-módban a toolbar HELYETT) */
export function PenBar({
  pointCount,
  onCancel,
  onUndoPoint,
  onClosePath,
  onDone,
}: {
  pointCount: number;
  onCancel: () => void;
  onUndoPoint: () => void;
  onClosePath: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={onCancel} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.penUndoPoint')}
        onPress={onUndoPoint}
        style={styles.cropBtn}
        hitSlop={6}
        disabled={!pointCount}
      >
        <Ionicons
          name="arrow-undo-outline"
          size={18}
          color={pointCount ? palette.text : palette.border}
        />
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={onClosePath}
        style={[styles.penClose, pointCount < 3 ? styles.penDisabled : null]}
        hitSlop={6}
        disabled={pointCount < 3}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.pen.close')}</Text>
      </Pressable>
      <Pressable
        onPress={onDone}
        style={[styles.cropApply, pointCount < 2 ? styles.penDisabled : null]}
        hitSlop={6}
        disabled={pointCount < 2}
      >
        <Ionicons name="checkmark" size={16} color="#fff" />
        <Text maxFontSizeMultiplier={1.3} style={styles.cropApplyText}>{t('common.done')}</Text>
      </Pressable>
    </View>
  );
}

/* ✏️ node-szerkesztő sáv (toll v2/v3 — a toolbar HELYETT) */
export function PathEditBar({
  nodeSelected,
  ringCount,
  ring,
  closed,
  onClose,
  onDeleteNode,
  onNodeKind,
  onNextRing,
  onToggleClosed,
  onReverse,
}: {
  nodeSelected: boolean;
  ringCount: number;
  ring: number;
  closed: boolean;
  onClose: () => void;
  onDeleteNode: () => void;
  onNodeKind: (type: NodeType) => void;
  onNextRing: () => void;
  onToggleClosed: () => void;
  onReverse: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      <View style={{ flex: 1 }} />
      {/* ✏️ v4: a kijelölt node törlése */}
      <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.deleteNode')}
        onPress={onDeleteNode}
        style={[styles.cropBtn, !nodeSelected ? styles.penDisabled : null]}
        hitSlop={6}
        disabled={!nodeSelected}
      >
        <Ionicons name="trash-outline" size={18} color={palette.danger} />
      </Pressable>
      {/* ✏️ a kijelölt node típusa, az útvonal iránya és nyitása */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.brushScroll}>
        {(['smooth', 'mirrored', 'broken', 'corner'] as const).map((type) => (
          <Pressable
            key={type}
            onPress={() => onNodeKind(type)}
            style={[styles.penClose, !nodeSelected ? styles.penDisabled : null]}
            hitSlop={6}
            disabled={!nodeSelected}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t(`studio.image.pen.${type}`)}</Text>
          </Pressable>
        ))}
        {ringCount > 1 ? (
          <Pressable
            onPress={onNextRing}
            style={styles.penClose}
            hitSlop={6}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.pen.ring', { n: (ring % ringCount) + 1, total: ringCount })}</Text>
          </Pressable>
        ) : ringCount === 0 ? (
          <Pressable onPress={onToggleClosed} style={styles.penClose} hitSlop={6}>
            <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t(closed ? 'studio.image.pen.open' : 'studio.image.pen.closePath')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onReverse} style={styles.penClose} hitSlop={6}>
          <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.pen.reverse')}</Text>
        </Pressable>
      </ScrollView>
      <Pressable onPress={onClose} style={styles.cropApply} hitSlop={6}>
        <Ionicons name="checkmark" size={16} color="#fff" />
        <Text maxFontSizeMultiplier={1.3} style={styles.cropApplyText}>{t('common.done')}</Text>
      </Pressable>
    </View>
  );
}

/* 🪢 lasszó-sáv (húzás a vásznon rajzol; felengedésre zár) */
export function LassoBar({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={onCancel} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.lassoLabel} numberOfLines={1}>
        {t('studio.image.lasso.hint')}
      </Text>
    </View>
  );
}

/* 🪄 varázspálca-sáv (fotóra koppintva szín-szelekció) */
export function WandBar({
  busy,
  tolerance,
  onTolerance,
  showContiguous,
  contiguous,
  onToggleContiguous,
  onClose,
}: {
  busy: boolean;
  tolerance: number;
  onTolerance: (value: number) => void;
  showContiguous: boolean;
  contiguous: boolean;
  onToggleContiguous: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      {busy ? <ActivityIndicator size="small" color={palette.accent} /> : null}
      <View style={styles.brushRow}>
        {WAND_TOLERANCES.map((w) => (
          <Chip key={w.value} label={t(w.labelKey)} active={tolerance === w.value} onPress={() => onTolerance(w.value)} />
        ))}
        {showContiguous ? (
          <Chip label={t('studio.image.wand.contiguous')} active={contiguous} onPress={onToggleContiguous} />
        ) : null}
      </View>
    </View>
  );
}

/* 🔲 S18: 4-sarkos perspektíva sáv (alaphelyzet + kész) */
export function CornerPinBar({ onReset, onDone }: { onReset: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable
        onPress={onReset}
        style={styles.penClose}
        hitSlop={6}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.cornerPin.reset')}</Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.lassoLabel} numberOfLines={1}>
        {t('studio.image.cornerPin.hint')}
      </Text>
      <Pressable onPress={onDone} style={styles.penClose} hitSlop={6} accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('common.done')}</Text>
      </Pressable>
    </View>
  );
}

/* 📐 vonalzók/segédvonalak sáv (Harmadok / Törlés + kilépés) */
export function GuidesBar({
  grid,
  onClose,
  onThirds,
  onClearGuides,
  onGrid,
}: {
  grid: ImageGrid | undefined;
  onClose: () => void;
  onThirds: () => void;
  onClearGuides: () => void;
  onGrid: (patch: Partial<ImageGrid>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.cropBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.cropBtn} hitSlop={6}>
        <Ionicons name="close" size={20} color={palette.text} />
      </Pressable>
      <Pressable
        onPress={onThirds}
        style={styles.penClose}
        hitSlop={6}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.guides.thirds')}</Text>
      </Pressable>
      <Pressable
        onPress={onClearGuides}
        style={styles.penClose}
        hitSlop={6}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.guides.clear')}</Text>
      </Pressable>
      <Pressable onPress={() => onGrid({ show: !(grid?.show ?? false) })} style={[styles.penClose, grid?.show ? styles.toggleOn : null]} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: !!grid?.show }}>
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.guides.grid')}</Text>
      </Pressable>
      <Pressable onPress={() => onGrid({ snap: !(grid?.snap ?? false) })} style={[styles.penClose, grid?.snap ? styles.toggleOn : null]} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: !!grid?.snap }}>
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.guides.snap')}</Text>
      </Pressable>
      <Pressable onPress={() => onGrid({ size: GRID_SIZES[(GRID_SIZES.indexOf(grid?.size ?? 32) + 1) % GRID_SIZES.length] })} style={styles.penClose} hitSlop={6} accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.3} style={styles.penCloseText}>{t('studio.image.guides.gridSize', { size: grid?.size ?? DEFAULT_GRID.size })}</Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.lassoLabel} numberOfLines={1}>
        {t('studio.image.guides.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cropBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cropBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropPresets: { alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  cropApply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 40,
    justifyContent: 'center',
  },
  cropApplyText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  penClose: {
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  penCloseText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  penDisabled: { opacity: 0.4 },
  lassoLabel: { flex: 1, color: palette.textDim, fontSize: 12, fontWeight: '600', paddingLeft: 4 },
  brushRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brushScroll: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  toggleOn: { borderColor: palette.accent, backgroundColor: `${palette.accent}33` },
});
