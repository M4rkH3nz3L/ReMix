import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HEADER_W } from '@/components/studio/audio/body/timelineMetrics';
import { palette } from '@/constants/editor';

/** 🧭 üres projekt: egyértelmű első lépés a sávok alatti üres területen (T1/A1) */
export function AudioEmptyGuide({ top, onAdd, onRecord }: { top: number; onAdd: () => void; onRecord: () => void }) {
  const { t } = useTranslation();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.emptyGuide, { top }]}
    >
      <Ionicons name="musical-notes-outline" size={28} color={palette.textDim} />
      <Text style={styles.emptyGuideText}>{t('studio.audio.emptyGuide')}</Text>
      <View style={styles.emptyGuideRow}>
        <Pressable
          onPress={onAdd}
          style={[styles.emptyGuideBtn, styles.emptyGuideBtnPrimary]}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.emptyGuideBtnTextPrimary}>{t('studio.audio.emptyGuideAdd')}</Text>
        </Pressable>
        <Pressable onPress={onRecord} style={styles.emptyGuideBtn} accessibilityRole="button">
          <Ionicons name="mic-outline" size={16} color={palette.text} />
          <Text style={styles.emptyGuideBtnText}>{t('studio.audio.emptyGuideRecord')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyGuide: { position: 'absolute', left: HEADER_W, right: 0, alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  emptyGuideText: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyGuideRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  emptyGuideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  emptyGuideBtnPrimary: { backgroundColor: palette.accent, borderColor: palette.accent },
  emptyGuideBtnText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  emptyGuideBtnTextPrimary: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
