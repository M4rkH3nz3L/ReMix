import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatThread } from '@/components/chat/ChatThread';
import { palette } from '@/constants/editor';
import { useChat } from '@/store/chatStore';

/** 💬 Beszélgetés (DM) — fejléc + közös ChatThread (buborékok, composer, realtime). */
export default function ChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const openConversation = useChat((s) => s.openConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === id));

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
        <ChatThread showSenders={conversation?.kind === 'project'} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 32 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
});
