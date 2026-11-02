import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { useActionMenu } from '@/store/actionMenuStore';

/** 🖐️ A hosszú nyomás menüje: egyszer a gyökérben, minden stúdió ide nyit. */
export function ActionMenuHost() {
  const title = useActionMenu((s) => s.title);
  const items = useActionMenu((s) => s.items);
  const close = useActionMenu((s) => s.close);
  if (!items) {
    return null;
  }
  return (
    <StudioSheet title={title} icon="ellipsis-horizontal-circle-outline" onClose={close}>
      <View style={styles.list}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            testID={`action-menu-${i}`}
            style={styles.row}
            onPress={() => {
              close();
              item.onPress();
            }}
            accessibilityRole="button"
          >
            {item.icon ? <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={22} color={item.destructive ? palette.danger : palette.text} /> : null}
            <Text style={[styles.label, item.destructive ? styles.danger : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  label: { color: palette.text, fontSize: 15, fontWeight: '600' },
  danger: { color: palette.danger },
});
