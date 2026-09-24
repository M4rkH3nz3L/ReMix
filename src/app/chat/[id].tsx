import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatThread } from '@/components/chat/ChatThread';
import { GroupCreateSheet } from '@/components/chat/GroupCreateSheet';
import { palette } from '@/constants/editor';
import { groupTitle, leaveConversation } from '@/lib/chat';
import { useChat } from '@/store/chatStore';

/** 💬 Beszélgetés (DM / projekt / csoport) — fejléc + közös ChatThread. */
export default function ChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const openConversation = useChat((s) => s.openConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const loadInbox = useChat((s) => s.loadInbox);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === id));
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (id) {
      void openConversation(id);
    }
    return () => closeConversation();
  }, [id, openConversation, closeConversation]);

  const isGroup = conversation?.kind === 'group';
  const title =
    conversation?.kind === 'project'
      ? t('chat.projectConversation')
      : isGroup
        ? groupTitle(conversation, t('chat.group'))
        : conversation?.peer?.name || t('chat.conversation');

  // csoport-kezelés: résztvevő hozzáadása / kilépés
  const manageGroup = () => {
    if (!id) {
      return;
    }
    Alert.alert(title, undefined, [
      { text: t('chat.addPeople'), onPress: () => setAddOpen(true) },
      {
        text: t('chat.leaveGroup'),
        style: 'destructive',
        onPress: () => {
          leaveConversation(id)
            .then(() => {
              void loadInbox();
              router.back();
            })
            .catch((e: unknown) =>
              Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
            );
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
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
        {isGroup ? (
          <Pressable
            onPress={manageGroup}
            hitSlop={10}
            style={styles.manageBtn}
            accessibilityLabel={t('chat.manageGroup')}
          >
            <Ionicons name="people-outline" size={22} color={palette.text} />
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ChatThread showSenders={conversation?.kind === 'project' || isGroup} />
      </KeyboardAvoidingView>

      {id ? (
        <GroupCreateSheet
          visible={addOpen}
          onClose={() => setAddOpen(false)}
          mode="add"
          conversationId={id}
          onDone={() => loadInbox()}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 32 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
  manageBtn: { width: 32, alignItems: 'flex-end' },
});
