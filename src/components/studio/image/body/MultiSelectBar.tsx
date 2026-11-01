import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { AlignEdge } from '@/lib/layout';

export type MultiAction = 'group' | 'duplicate' | 'delete' | AlignEdge;

const ACTIONS: { key: MultiAction; icon: keyof typeof Ionicons.glyphMap; labelKey: string; min: number }[] = [
  { key: 'group', icon: 'folder-outline', labelKey: 'group', min: 2 },
  { key: 'left', icon: 'arrow-back', labelKey: 'left', min: 2 },
  { key: 'hcenter', icon: 'remove-outline', labelKey: 'hcenter', min: 2 },
  { key: 'right', icon: 'arrow-forward', labelKey: 'right', min: 2 },
  { key: 'top', icon: 'arrow-up', labelKey: 'top', min: 2 },
  { key: 'vcenter', icon: 'reorder-two-outline', labelKey: 'vcenter', min: 2 },
  { key: 'bottom', icon: 'arrow-down', labelKey: 'bottom', min: 2 },
  { key: 'duplicate', icon: 'copy-outline', labelKey: 'duplicate', min: 1 },
];

/** 🖐️ Több réteg műveletei: a koppintás a vásznon vesz fel vagy vesz le réteget. */
export function MultiSelectBar({ count, onAction, onClose }: { count: number; onAction: (action: MultiAction) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      <Pressable testID="multi-close" style={styles.icon} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
        <Ionicons name="close" size={22} color={palette.text} />
      </Pressable>
      <Text style={styles.count}>{t('studio.image.multi.count', { count })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        {ACTIONS.filter((a) => count >= a.min).map((a) => (
          <Pressable key={a.key} testID={`multi-${a.key}`} style={styles.action} onPress={() => onAction(a.key)} accessibilityRole="button">
            <Ionicons name={a.icon} size={22} color={palette.text} />
            <Text style={styles.label} numberOfLines={1}>{t(`studio.image.multi.${a.labelKey}`)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {count > 0 ? (
        <Pressable testID="multi-delete" style={styles.icon} onPress={() => onAction('delete')} accessibilityRole="button" accessibilityLabel={t('common.delete')}>
          <Ionicons name="trash-outline" size={22} color={palette.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 4, paddingHorizontal: 6, backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  count: { color: palette.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scroll: { flex: 1 },
  row: { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  action: { minWidth: 56, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  label: { color: palette.textDim, fontSize: 10, fontWeight: '700' },
});
