import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SelectTool } from '@/components/studio/image/body/SelectionBar';
import { palette } from '@/constants/editor';
import { layerLabel } from '@/lib/imageDoc';
import type { ImageLayer } from '@/types/project';

/**
 * ℹ️ A vászon alatti állapot-sorok (export folyamatban / aktív kijelölés / mód-tipp + undo/redo).
 * VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: ugyanaz a feltétel-lánc és sorrend.
 */

/** ⏳ export folyamatban — leállítható */
export function ExportingRow({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.statusRow}>
      <ActivityIndicator size="small" color={palette.accent} />
      <Text maxFontSizeMultiplier={1.3} style={styles.statusText} numberOfLines={1}>
        {t('studio.image.export.exporting')}
      </Text>
      <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.3} style={styles.selectLink}>{t('studio.image.export.cancel')}</Text>
      </Pressable>
    </View>
  );
}

/* ✂️ a kijelölés a többi eszköz alatt is él: innen szerkeszthető vagy szüntethető meg */
export function ActiveSelectionRow({ onEdit, onClear }: { onEdit: () => void; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.statusRow}>
      <Ionicons name="scan-outline" size={12} color={palette.accent} />
      <Text maxFontSizeMultiplier={1.3} style={styles.statusText} numberOfLines={1}>
        {t('studio.image.select.active')}
      </Text>
      <Pressable onPress={onEdit} hitSlop={6} accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.3} style={styles.selectLink}>{t('studio.image.select.edit')}</Text>
      </Pressable>
      <Pressable onPress={onClear} hitSlop={6} accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.3} style={styles.selectLink}>{t('studio.image.select.clear')}</Text>
      </Pressable>
    </View>
  );
}

/** kijelölés-jelző: a mód tippje (vagy a kijelölt réteg neve) + a mindig kézre eső undo/redo */
export function StatusHintRow({
  selectedLayer,
  guidesActive,
  brushActive,
  retouch,
  needSource,
  selectTool,
  wandActive,
  lassoActive,
  pathEditing,
  penDrawing,
  cropping,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  selectedLayer: ImageLayer | null;
  guidesActive: boolean;
  brushActive: boolean;
  /** az ecset retus-eszközzel fut (`brush.tool` be van állítva) */
  retouch: boolean;
  needSource: boolean;
  selectTool: SelectTool | null;
  wandActive: boolean;
  lassoActive: boolean;
  pathEditing: boolean;
  penDrawing: boolean;
  cropping: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.statusRow}>
      <Ionicons
        name={selectedLayer ? 'ellipse' : 'ellipse-outline'}
        size={9}
        color={selectedLayer ? palette.accent : palette.textDim}
      />
      <Text maxFontSizeMultiplier={1.3} style={styles.statusText} numberOfLines={2}>
        {guidesActive
          ? t('studio.image.guides.hint')
          : brushActive
          ? retouch
            ? t(needSource ? 'studio.image.retouch.pickHint' : 'studio.image.retouch.hint')
            : t('studio.image.brush.hint')
          : selectTool === 'rect' || selectTool === 'ellipse'
          ? t('studio.image.select.hint')
          : wandActive
          ? t('studio.image.wand.hint')
          : lassoActive
          ? t('studio.image.lasso.hint')
          : pathEditing
            ? t('studio.image.pen.editHint')
            : penDrawing
              ? t('studio.image.pen.hint')
              : cropping
                ? t('studio.image.crop.hint')
                : selectedLayer
                  ? t('studio.image.selected', { name: layerLabel(selectedLayer) })
                  : t('studio.image.tapToSelect')}
      </Text>
      {/* ↩️ mindig kézre esik, a precíziós módokban is */}
      <Pressable style={styles.historyBtn} onPress={onUndo} disabled={!canUndo} accessibilityRole="button" accessibilityLabel={t('studio.image.undo')} accessibilityState={{ disabled: !canUndo }}>
        <Ionicons name="arrow-undo" size={20} color={canUndo ? palette.text : palette.border} />
      </Pressable>
      <Pressable style={styles.historyBtn} onPress={onRedo} disabled={!canRedo} accessibilityRole="button" accessibilityLabel={t('studio.image.redo')} accessibilityState={{ disabled: !canRedo }}>
        <Ionicons name="arrow-redo" size={20} color={canRedo ? palette.text : palette.border} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 0,
  },
  historyBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  statusText: { flex: 1, color: palette.textDim, fontSize: 11, fontWeight: '600' },
  selectLink: { color: palette.accent, fontSize: 12, fontWeight: '700' },
});
