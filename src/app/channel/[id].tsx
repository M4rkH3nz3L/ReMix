import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { palette } from '@/constants/editor';
import { getChannel, remixFromPost, toggleFollow, type ChannelData } from '@/lib/feed';
import type { FeedPost } from '@/types/social';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function ChannelScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ChannelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);

  const load = useCallback(() => {
    if (!id) {
      return;
    }
    getChannel(id)
      .then((d) => {
        setData(d);
        setFollowing(d.isFollowing);
        setFollowers(d.followers);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onFollow = () => {
    if (!id) {
      return;
    }
    const next = !following;
    setFollowing(next);
    setFollowers((n) => n + (next ? 1 : -1));
    toggleFollow(id, next).catch(() => {});
  };

  const openPost = (post: FeedPost) => {
    if (post.projectId && data?.isMe) {
      router.push(`/player/${post.projectId}`);
      return;
    }
    if (post.remixable && post.projectSnapshot) {
      Alert.alert(post.title, t('feed.remixPrompt'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('feed.remix'),
          onPress: () =>
            remixFromPost(post).then((pid) => {
              if (pid) {
                router.push(`/editor/${pid}`);
              }
            }),
        },
      ]);
    }
  };

  const displayName = data?.creator?.displayName ?? t('nav.channel');
  const username = data?.creator?.username ?? (id ?? '').slice(0, 8);

  const gridItem = ({ item }: { item: FeedPost }) => (
    <Pressable style={styles.gridItem} onPress={() => openPost(item)}>
      {item.posterUri ? (
        <Image source={{ uri: item.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.gridPlaceholder}>
          <Text style={styles.gridEmoji}>🎬</Text>
          <Text style={styles.gridTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
      )}
      <View style={styles.gridViews}>
        <Ionicons name="play" size={11} color="#fff" />
        <Text style={styles.gridViewsText}>{compact(item.counts.views)}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          @{username}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={data?.posts ?? []}
          key="grid3"
          numColumns={3}
          keyExtractor={(p) => p.id}
          renderItem={gridItem}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 24 }}
          ListHeaderComponent={
            <View style={styles.profileHead}>
              <View style={styles.bigAvatar}>
                <Text style={styles.bigAvatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.displayName}>{displayName}</Text>
              <Text style={styles.handle}>@{username}</Text>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{compact(data?.postCount ?? 0)}</Text>
                  <Text style={styles.statLabel}>{t('channel.posts')}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{compact(followers)}</Text>
                  <Text style={styles.statLabel}>{t('channel.followers')}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{compact(data?.following ?? 0)}</Text>
                  <Text style={styles.statLabel}>{t('channel.following')}</Text>
                </View>
              </View>
              {data?.isMe ? (
                <Pressable style={styles.editBtn} onPress={() => router.push('/profile')}>
                  <Ionicons name="settings-outline" size={16} color={palette.text} />
                  <Text style={styles.editBtnText}>{t('channel.editProfile')}</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.followBtn, following && styles.followingBtn]}
                  onPress={onFollow}
                >
                  <Text style={[styles.followBtnText, following && styles.followingBtnText]}>
                    {following ? t('channel.following2') : t('channel.follow')}
                  </Text>
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('channel.noPosts')}</Text>}
        />
      )}

      <BottomNav active="channel" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 32 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileHead: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  bigAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigAvatarText: { color: '#fff', fontSize: 40, fontWeight: '800' },
  displayName: { color: palette.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  handle: { color: palette.textDim, fontSize: 14 },
  stats: { flexDirection: 'row', gap: 28, marginTop: 12 },
  stat: { alignItems: 'center' },
  statNum: { color: palette.text, fontSize: 17, fontWeight: '800' },
  statLabel: { color: palette.textDim, fontSize: 12 },
  followBtn: {
    marginTop: 14,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 40,
    paddingVertical: 10,
  },
  followingBtn: { backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  followingBtnText: { color: palette.text },
  editBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 9,
  },
  editBtnText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  gridRow: { gap: 3, paddingHorizontal: 3 },
  gridItem: {
    flex: 1 / 3,
    aspectRatio: 0.62,
    marginBottom: 3,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 },
  gridEmoji: { fontSize: 22 },
  gridTitle: { color: palette.textDim, fontSize: 10, textAlign: 'center' },
  gridViews: { position: 'absolute', left: 5, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridViewsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { color: palette.textDim, textAlign: 'center', paddingVertical: 40 },
});
