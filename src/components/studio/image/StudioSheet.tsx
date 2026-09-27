import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🎨 Kép-stúdió alsó lap (bottom sheet) — a réteg-panel és a korrekció-lap közös
 * kerete. Áttetsző Modal + alsó kártya + scrim; a fejléc a cím és a bezárás.
 */
export function StudioSheet({
  title,
  icon,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.grip} />
        <View style={styles.head}>
          {icon ? <Ionicons name={icon} size={16} color={palette.accent} /> : null}
          <Text style={styles.title}>{title}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  scroll: { maxHeight: 440 },
  scrollContent: { paddingBottom: 8, gap: 12 },
  footer: { marginTop: 10 },
});
