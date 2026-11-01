import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { type ImageCommand, parseImageIntent } from '@/lib/imageIntent';
import type { ImageDoc } from '@/types/project';

const EXAMPLES = ['example1', 'example2', 'example3'];

/**
 * 🤖 Kép-asszisztens: a mondatot gépelés közben értelmezi, megmutatja a lépéseket, és csak a
 * jóváhagyásra hajtja végre, egy visszavonható lépésként. Ami nem érthető, az látszik, nem fut le.
 */
export function AssistantBar({
  doc,
  selectedId,
  onApply,
  onClose,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onApply: (commands: ImageCommand[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const { commands, unknown } = useMemo(() => parseImageIntent(text, doc, selectedId), [text, doc, selectedId]);
  const typed = text.trim().length > 0;

  // a sáv a képernyő alján van: a billentyűzet fölé kell emelkednie, különben a gépelés vak
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View style={[styles.bar, { marginBottom: keyboard }]}>
      <View style={styles.row}>
        <Pressable onPress={onClose} style={styles.icon} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={18} color={palette.text} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('studio.image.assistant.placeholder')}
          placeholderTextColor={palette.textDim}
          style={styles.input}
          returnKeyType="done"
          autoFocus
          autoCorrect={false}
        />
        <Pressable
          onPress={() => {
            onApply(commands);
            setText('');
          }}
          disabled={commands.length === 0}
          style={[styles.apply, commands.length === 0 && styles.off]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ disabled: commands.length === 0 }}
        >
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.applyText}>{t('studio.image.assistant.apply', { count: commands.length })}</Text>
        </Pressable>
      </View>
      {typed ? (
        <ScrollView style={styles.steps} keyboardShouldPersistTaps="handled">
          {commands.map((c, i) => (
            <Text key={i} style={styles.step}>{`${i + 1}. ${t(`studio.image.assistant.cmd.${c.type}`)}`}</Text>
          ))}
          {unknown.map((u) => (
            <Text key={u} style={styles.unknown}>{t('studio.image.assistant.unknown', { text: u })}</Text>
          ))}
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.examples}>
          {EXAMPLES.map((key) => (
            <Pressable key={key} onPress={() => setText(t(`studio.image.assistant.${key}`))} style={styles.chip} accessibilityRole="button">
              <Text style={styles.chipText}>{t(`studio.image.assistant.${key}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 10, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, backgroundColor: palette.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 10, color: palette.text, fontSize: 14 },
  apply: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.accent },
  applyText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  off: { opacity: 0.4 },
  steps: { maxHeight: 110 },
  step: { color: palette.text, fontSize: 13, paddingVertical: 2 },
  unknown: { color: palette.textDim, fontSize: 13, paddingVertical: 2, fontStyle: 'italic' },
  examples: { gap: 6 },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: palette.border, justifyContent: 'center' },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '600' },
});
