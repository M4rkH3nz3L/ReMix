import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { palette } from '@/constants/editor';
import type { Conversation } from '@/lib/chat';
import { useChat } from '@/store/chatStore';

/** Rövid, relatív idő (most/perc/óra/nap). */
function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'most';
  if (s < 3600) return `${Math.floor(s / 60)}p`;
  if (s < 86400) return `${Math.floor(s / 3600)}ó`;
  if (s < 604800) return `${Math.floor(s / 86400)}n`;
  return `${Math.floor(s / 604800)}h`;
}

/** 📥 Inbox — a beszélgetéseim (DM + projekt-chat), olvasatlan-jelzéssel. */
export default function InboxScreen() {
  const { t } = useTranslation();
  const conversations = useChat((s) => s.conversations);
  const loading = useChat((s) => s.inboxLoading);
  const loadInbox = useChat((s) => s.loadInbox);

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
    const title = isProject
      ? t('chat.projectConversation')
      : item.peer?.name || t('chat.someone');
    return (
      <Pressable style={styles.row} onPress={() => open(item)} accessibilityRole="button">
        <View style={styles.avatar}>
          {isProject ? (
            <Ionicons name="people" size={22} color="#fff" />
          ) : item.peer?.avatar ? (
            <Image source={{ uri: item.peer.avatar }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Text style={styles.avatarText}>{(title || '?').slice(0, 1).toUpperCase()}</Text>
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
          <Text style={styles.rowTime}>{timeAgo(item.lastMessageAt)}</Text>
          {item.hasUnread ? <View style={styles.dot} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('chat.inbox')}</Text>
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
      <BottomNav active="chat" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
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
