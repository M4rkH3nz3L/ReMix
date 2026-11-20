import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';

/** többes kijelölés: a koppintás hozzáad, innen lehet kilépni */
export function MultiSelectBar({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID="audio-multi-exit"
      style={styles.multiBar}
      onPress={() => useEditorStore.getState().setMultiSelectMode(false)}
      accessibilityRole="button"
      accessibilityLabel={t('common.cancel')}
    >
      <Text style={styles.multiText}>{t('editor.toolbar.multiSelectActive', { count })}</Text>
      <Ionicons name="close" size={20} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  multiBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, backgroundColor: palette.surfaceHigh },
  multiText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
