import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import type { ImageWorkspace } from '@/lib/imageMenu';
import type { ImageDoc } from '@/types/project';

/**
 * 🔝 A Kép Stúdió felső sávja: vissza/bezárás, munkaterület-váltó + cím, előzmények, vászonméret,
 * export (project) / kész (scoped). VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — minden
 * handler propból jön; precíziós módban a sáv rejtett (`hidden`), de a fában marad.
 */
export function StudioTopBar({
  mode,
  title,
  doc,
  workspaceTab,
  busy,
  hidden,
  onExit,
  onToggleWorkspace,
  onHistory,
  onCanvas,
  onPrimary,
}: {
  mode: 'project' | 'scoped';
  title: string;
  doc: ImageDoc | null;
  workspaceTab: ImageWorkspace;
  busy: boolean;
  hidden: boolean;
  onExit: () => void;
  onToggleWorkspace: () => void;
  onHistory: () => void;
  onCanvas: () => void;
  onPrimary: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.topBar, hidden ? styles.hidden : null]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t(mode === 'scoped' ? 'common.close' : 'common.back')} onPress={onExit} hitSlop={10} style={styles.topBtn}>
        <Ionicons name={mode === 'scoped' ? 'close' : 'chevron-back'} size={26} color={palette.text} />
      </Pressable>
      <View style={styles.titleWrap}>
        {/* 🎨 munkaterület-váltó (IMAGE-PROD S8): Kép ↔ Design — ugyanaz a dokumentum, más szerszám-sorrend */}
        <Pressable
          style={styles.kindTag}
          onPress={onToggleWorkspace}
          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${t('studio.image.workspace.label')}: ${t(`studio.image.workspace.${workspaceTab}`)}`}
          testID="image-workspace-toggle"
        >
          <Ionicons name={workspaceTab === 'design' ? 'color-palette' : 'image'} size={12} color={palette.accent} />
          <Text maxFontSizeMultiplier={1.3} style={styles.kindTagText}>{t(`studio.image.workspace.${workspaceTab}`)}</Text>
          <Ionicons name="swap-horizontal" size={11} color={palette.textDim} />
        </Pressable>
        <Text maxFontSizeMultiplier={1.3} style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {doc ? (
        <Pressable
          onPress={onHistory}
          hitSlop={8}
          style={styles.canvasBtn}
          accessibilityRole="button"
          accessibilityLabel={t('studio.image.historyTitle', { defaultValue: 'Előzmények' })}
        >
          <Ionicons name="time-outline" size={15} color={palette.textDim} />
        </Pressable>
      ) : null}
      {doc ? (
        <Pressable
          onPress={onCanvas}
          hitSlop={8}
          style={styles.canvasBtn}
          accessibilityRole="button"
          accessibilityLabel={t('studio.image.canvasTitle')}
        >
          <Ionicons name="resize-outline" size={14} color={palette.textDim} />
          <Text maxFontSizeMultiplier={1.3} style={styles.canvasBtnText}>
            {effectiveCanvas(doc).width}×{effectiveCanvas(doc).height}
            {doc.format === 'vector' ? ' · SVG' : ''}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPrimary}
        hitSlop={10}
        style={styles.exportBtn}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name={mode === 'scoped' ? 'checkmark' : 'share-outline'} size={16} color="#fff" />
        )}
        <Text maxFontSizeMultiplier={1.3} style={styles.exportText}>
          {mode === 'scoped' ? t('common.done') : t('studio.export')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, gap: 2 },
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindTagText: { color: palette.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 84,
    justifyContent: 'center',
  },
  exportText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  canvasBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: palette.surface,
  },
  canvasBtnText: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
});
