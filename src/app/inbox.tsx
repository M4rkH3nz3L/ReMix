import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { GroupCreateSheet } from '@/components/chat/GroupCreateSheet';
import { palette } from '@/constants/editor';
import { groupTitle, type Conversation } from '@/lib/chat';
import { timeAgoParts } from '@/lib/timeAgo';
import { useChat } from '@/store/chatStore';


/** 📥 Inbox — a beszélgetéseim (DM + projekt-chat), olvasatlan-jelzéssel. */
export default function InboxScreen() {
  const { t } = useTranslation();
  const conversations = useChat((s) => s.conversations);
  const loading = useChat((s) => s.inboxLoading);
  const loadInbox = useChat((s) => s.loadInbox);
  const [groupOpen, setGroupOpen] = useState(false);

  // képernyőre lépéskor frissítünk (a realtime-figyelést a root indítja a badge-hez)
  useFocusEffect(
    useCallback(() => {
      void loadInbox();
    }, [loadInbox])
  );

  const open = (c: Conversation) => {
    router.push(`/chat/${c.id}`);
  };

  const row = ({ item }: { item: Conversation }) => {
    const isProject = item.kind === 'project';
    const isGroup = item.kind === 'group';
    // a projekt-chat a projekt NEVÉT viseli (több projekt-csevegés ne legyen egyforma)
    const title = isProject
      ? item.projectName || t('chat.projectConversation')
      : isGroup
        ? groupTitle(item, t('chat.group'))
        : item.peer?.name || t('chat.someone');
    // a DM partnere, vagy az egytagú csoport egyetlen másik tagja → személyes avatar
    const avatarPeer = isGroup ? item.members?.[0] : item.peer;
    const ago = timeAgoParts(item.lastMessageAt);
    return (
      <Pressable style={styles.row} onPress={() => open(item)} accessibilityRole="button">
        <View style={styles.avatar}>
          {isProject ? (
            <Ionicons name="film-outline" size={22} color="#fff" />
          ) : isGroup && (item.members?.length ?? 0) !== 1 ? (
            <Ionicons name="people" size={22} color="#fff" />
          ) : avatarPeer?.avatar ? (
            <Image source={{ uri: avatarPeer.avatar }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Text style={styles.avatarText}>{(avatarPeer?.name || title || '?').slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.rowMid}>
          <Text style={[styles.rowTitle, item.hasUnread && styles.unreadText]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.rowPreview, item.hasUnread && styles.unreadPreview]} numberOfLines={1}>
            {item.lastMessagePreview || t('chat.noMessages')}
          </Text>
        </View>
        <View style={styles.rowEnd}>
          <Text style={styles.rowTime}>{t(`time.ago_${ago.unit}`, { count: ago.count })}</Text>
          {item.hasUnread ? <View style={styles.dot} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('chat.inbox')}</Text>
        <Pressable
          onPress={() => setGroupOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('chat.newGroup')}
        >
          <Ionicons name="create-outline" size={24} color={palette.text} />
        </Pressable>
      </View>
      {loading && conversations.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          renderItem={row}
          contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 24 }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubbles-outline" size={40} color={palette.textDim} />
              <Text style={styles.empty}>{t('chat.inboxEmpty')}</Text>
            </View>
          }
        />
      )}
      <GroupCreateSheet
        visible={groupOpen}
        onClose={() => setGroupOpen(false)}
        mode="create"
        onDone={(cid) => router.push(`/chat/${cid}`)}
      />
      <BottomNav active="chat" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: palette.text, fontSize: 22, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  rowMid: { flex: 1, gap: 2 },
  rowTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  rowPreview: { color: palette.textDim, fontSize: 13 },
  unreadText: { fontWeight: '800' },
  unreadPreview: { color: palette.text, fontWeight: '600' },
  rowEnd: { alignItems: 'flex-end', gap: 6 },
  rowTime: { color: palette.textDim, fontSize: 11 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.accent },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  empty: { color: palette.textDim, fontSize: 14 },
});
