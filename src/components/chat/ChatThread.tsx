import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { palette } from '@/constants/editor';
import { haptics } from '@/design';
import { currentUserId, type ChatMessage } from '@/lib/chat';
import { useChat } from '@/store/chatStore';

/**
 * 💬 Üzenet-szál — buborékok (inverted lista, legújabb alul) + composer. A chatStore
 * hajtja (aktív beszélgetés + realtime); a DM-képernyő ÉS a collab-chat panel is ezt
 * használja (nincs duplikált buborék/küldés-logika). A megnyitást/zárást a SZÜLŐ
 * intézi (openConversation/closeConversation).
 */
export function ChatThread({ showSenders = false }: { showSenders?: boolean }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const loading = useChat((s) => s.activeLoading);
  const send = useChat((s) => s.send);
  const typingName = useChat((s) => s.typingName);
  const notifyTyping = useChat((s) => s.notifyTyping);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const me = currentUserId();

  // inverted lista → legújabb alul, auto-tapadás
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setText('');
    setSending(true);
    haptics.selection();
    try {
      await send(body);
    } catch {
      setText(body); // hibánál visszatesszük, hogy ne vesszen el
    } finally {
      setSending(false);
    }
  };

  const bubble = ({ item }: { item: ChatMessage }) => {
    const mine = item.senderId === me;
    return (
      <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {!mine && showSenders && item.senderName ? (
            <Text style={styles.sender}>{item.senderName}</Text>
          ) : null}
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <>
      {loading && messages.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={inverted}
          keyExtractor={(m) => m.id}
          renderItem={bubble}
          inverted
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{t('chat.startHint')}</Text>
            </View>
          }
        />
      )}
      {typingName ? (
        <Text style={styles.typing}>{t('chat.typing', { name: typingName })}</Text>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(v) => {
            setText(v);
            notifyTyping();
          }}
          placeholder={t('chat.messagePlaceholder')}
          placeholderTextColor={palette.textDim}
          multiline
          maxLength={4000}
        />
        <Pressable
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={!text.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
        >
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  typing: {
    color: palette.textDim,
    fontSize: 12,
    fontStyle: 'italic',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 12, paddingVertical: 12, gap: 6 },
  bubbleRow: { flexDirection: 'row', marginVertical: 1 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleMine: { backgroundColor: palette.accent, borderBottomRightRadius: 5 },
  bubbleOther: { backgroundColor: palette.surfaceHigh, borderBottomLeftRadius: 5 },
  sender: { color: palette.accent2, fontSize: 11, fontWeight: '800', marginBottom: 2 },
  bubbleText: { color: palette.text, fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 40, transform: [{ scaleY: -1 }] },
  empty: { color: palette.textDim, fontSize: 13 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    color: palette.text,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
