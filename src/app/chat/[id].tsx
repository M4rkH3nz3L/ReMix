import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { currentUserId, type ChatMessage } from '@/lib/chat';
import { useChat } from '@/store/chatStore';

/** 💬 Beszélgetés — buborékok + composer, realtime (a chatStore hajtja). */
export default function ChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const messages = useChat((s) => s.messages);
  const loading = useChat((s) => s.activeLoading);
  const openConversation = useChat((s) => s.openConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const send = useChat((s) => s.send);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === id));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const me = currentUserId();

  useEffect(() => {
    if (id) {
      void openConversation(id);
    }
    return () => closeConversation();
  }, [id, openConversation, closeConversation]);

  const title =
    conversation?.kind === 'project'
      ? t('chat.projectConversation')
      : conversation?.peer?.name || t('chat.conversation');

  // inverted lista → legújabb alul, auto-tapadás; a data-t megfordítjuk
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setText('');
    setSending(true);
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
          {!mine && conversation?.kind === 'project' && item.senderName ? (
            <Text style={styles.sender}>{item.senderName}</Text>
          ) : null}
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
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
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Text style={styles.empty}>{t('chat.startHint')}</Text>
              </View>
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 32 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
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
