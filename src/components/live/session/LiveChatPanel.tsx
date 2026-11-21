import { Ionicons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { LIVE_REACTIONS, type LiveChat } from '@/lib/live';

/**
 * 💬 Az élő adás chatje + reakciói + beviteli sora (REFACTOR: a src/app/live/[id].tsx-ből).
 * A küldés a gyökér realtime szobáján megy (onSendChat / onReact); a görgetés-ref és a
 * beviteli szöveg állapota a gyökérben él.
 */

// a reakciók a közös fehérlistából (a bejövő broadcast is csak ezeket fogadja — L2)
const REACTIONS = LIVE_REACTIONS;

export interface LiveChatPanelProps {
  scrollRef: RefObject<ScrollView | null>;
  chat: LiveChat[];
  text: string;
  setText: (text: string) => void;
  onSendChat: () => void;
  onReact: (emoji: string) => void;
}

export function LiveChatPanel({ scrollRef, chat, text, setText, onSendChat, onReact }: LiveChatPanelProps) {
  const { t } = useTranslation();
  return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {chat.map((m, i) => (
              <View key={`${m.id}-${m.at}-${i}`} style={styles.chatRow}>
                <Text style={styles.chatName}>{m.name}</Text>
                <Text style={styles.chatText}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.reactRow}>
            {REACTIONS.map((e) => (
              <Pressable key={e} onPress={() => onReact(e)} style={styles.reactBtn} hitSlop={6}>
                <Text style={styles.reactEmoji}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('live.chatPlaceholder')}
              placeholderTextColor="#ffffff99"
              style={styles.chatInput}
              maxLength={500}
              onSubmitEditing={onSendChat}
              returnKeyType="send"
            />
            <Pressable onPress={onSendChat} style={styles.sendBtn} hitSlop={6}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chatScroll: { maxHeight: 220 },
  chatContent: { gap: 6, paddingVertical: 8 },
  chatRow: { backgroundColor: '#00000055', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', maxWidth: '92%' },
  chatName: { color: palette.accent, fontSize: 12, fontWeight: '800' },
  chatText: { color: '#fff', fontSize: 14, marginTop: 1 },

  reactRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  reactBtn: { backgroundColor: '#00000055', borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reactEmoji: { fontSize: 22 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  chatInput: {
    flex: 1,
    backgroundColor: '#ffffff1f',
    borderRadius: 999,
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: { backgroundColor: palette.accent, borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
