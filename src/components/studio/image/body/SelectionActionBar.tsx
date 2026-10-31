import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { type LayerAction, type SelectionMenu, TOOL_ICONS, toolLabelKey } from '@/lib/imageMenu';

/**
 * 🎯 A kijelölt elem műveletei az alsó sávban: görgethető lista, a törlés külön, a jobb
 * szélen mindig látszik. Csak akkor jelenik meg, ha van kijelölés.
 */
export function SelectionActionBar({
  menu,
  onAction,
  onDelete,
}: {
  menu: SelectionMenu;
  onAction: (key: LayerAction) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
        {menu.actions.map((key) => (
          <Pressable key={key} style={styles.action} onPress={() => onAction(key)} accessibilityRole="button" accessibilityLabel={t(toolLabelKey(key))}>
            <Ionicons name={TOOL_ICONS[key] as keyof typeof Ionicons.glyphMap} size={22} color={palette.text} />
            <Text style={styles.label} numberOfLines={1}>
              {t(toolLabelKey(key))}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {menu.canDelete ? (
        <Pressable style={styles.deleteBtn} onPress={onDelete} accessibilityRole="button" accessibilityLabel={t(toolLabelKey('delete'))}>
          <Ionicons name={TOOL_ICONS.delete as keyof typeof Ionicons.glyphMap} size={22} color={palette.danger} />
          <Text style={[styles.label, { color: palette.danger }]} numberOfLines={1}>
            {t(toolLabelKey('delete'))}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 6 },
  action: { width: 68, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { color: palette.textDim, fontSize: 10, fontWeight: '600' },
  deleteBtn: {
    width: 68,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
});
