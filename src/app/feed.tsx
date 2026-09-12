import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { palette } from '@/constants/editor';
import {
  listFeed,
  recordView,
  remixFromPost,
  toggleFollow,
  toggleLike,
  toggleSave,
} from '@/lib/feed';
import type { FeedMode, FeedPost } from '@/types/social';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function FeedScreen() {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const [mode, setMode] = useState<FeedMode>('foryou');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback((m: FeedMode) => {
    listFeed(m)
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(mode);
  }, [load, mode]);

  const changeMode = (m: FeedMode) => {
    if (m === mode) {
      return;
    }
    setLoading(true);
    setPosts([]);
    setMode(m);
  };

  const patch = (id: string, fn: (p: FeedPost) => FeedPost) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));

  const onLike = (post: FeedPost) => {
    const liked = !post.viewerLiked;
    patch(post.id, (p) => ({
      ...p,
      viewerLiked: liked,
      counts: { ...p.counts, likes: p.counts.likes + (liked ? 1 : -1) },
    }));
    toggleLike(post.id, liked).catch(() => {});
  };

  const onSave = (post: FeedPost) => {
    const saved = !post.viewerSaved;
    patch(post.id, (p) => ({
      ...p,
      viewerSaved: saved,
      counts: { ...p.counts, saves: p.counts.saves + (saved ? 1 : -1) },
    }));
    toggleSave(post.id, saved).catch(() => {});
  };

  const onRemix = (post: FeedPost) => {
    if (busy) {
      return;
    }
    if (!post.remixable || !post.projectSnapshot) {
      Alert.alert(t('feed.title'), t('feed.notRemixable'));
      return;
    }
    setBusy(true);
    remixFromPost(post)
      .then((pid) => {
        if (pid) {
          router.push(`/editor/${pid}`);
        }
      })
      .catch((e: unknown) => Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const onFollow = (post: FeedPost) => {
    toggleFollow(post.creator.id, true).catch(() => {});
    Alert.alert(t('feed.title'), t('feed.followed', { name: post.creator.displayName }));
  };

  const viewedRef = useRef<Set<string>>(new Set());
  const onViewable = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems[0]?.item as FeedPost | undefined;
    if (first && !viewedRef.current.has(first.id)) {
      viewedRef.current.add(first.id);
      recordView(first.id);
    }
  }).current;

  const openCreator = (post: FeedPost) => router.push(`/channel/${post.creator.id}`);
  const openPost = (post: FeedPost) => {
    if (post.videoUri) {
      // renderelt videó (Storage) — a lejátszó kezeli
      return;
    }
    if (post.projectId) {
      router.push(`/player/${post.projectId}`);
    }
  };

  const pageHeight = height;

  const renderItem = ({ item }: { item: FeedPost }) => (
    <View style={[styles.page, { height: pageHeight, width }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => openPost(item)}>
        {item.posterUri ? (
          <Image source={{ uri: item.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={['#1a1e2e', '#0c0d12', '#241a3a']} style={StyleSheet.absoluteFill} />
        )}
      </Pressable>

      {/* felül: cím + típus */}
      {!item.posterUri ? (
        <View style={styles.centerTitle} pointerEvents="none">
          <Text style={styles.centerEmoji}>🎬</Text>
          <Text style={styles.centerText} numberOfLines={3}>
            {item.title}
          </Text>
        </View>
      ) : null}

      {/* jobb oldali akció-sor */}
      <View style={[styles.rail, { bottom: BOTTOM_NAV_HEIGHT + 24 }]}>
        <Pressable style={styles.railBtn} onPress={() => openCreator(item)}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(item.creator.displayName || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Pressable style={styles.followDot} onPress={() => onFollow(item)} hitSlop={6}>
            <Ionicons name="add" size={12} color="#fff" />
          </Pressable>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onLike(item)}>
          <Ionicons
            name={item.viewerLiked ? 'heart' : 'heart-outline'}
            size={34}
            color={item.viewerLiked ? palette.danger : '#fff'}
          />
          <Text style={styles.railCount}>{compact(item.counts.likes)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => openPost(item)}>
          <Ionicons name="chatbubble-outline" size={32} color="#fff" />
          <Text style={styles.railCount}>{compact(item.counts.comments)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onSave(item)}>
          <Ionicons
            name={item.viewerSaved ? 'bookmark' : 'bookmark-outline'}
            size={30}
            color={item.viewerSaved ? palette.accent2 : '#fff'}
          />
          <Text style={styles.railCount}>{compact(item.counts.saves)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onRemix(item)}>
          <Ionicons name="shuffle" size={32} color={palette.accent} />
          <Text style={styles.railCount}>{compact(item.counts.remixes)}</Text>
        </Pressable>
      </View>

      {/* alul-bal: alkotó + felirat */}
      <View style={[styles.caption, { bottom: BOTTOM_NAV_HEIGHT + 24 }]}>
        <Pressable onPress={() => openCreator(item)}>
          <Text style={styles.creator}>@{item.creator.username}</Text>
        </Pressable>
        <Text style={styles.captionText} numberOfLines={2}>
          {item.title}
        </Text>
        {item.hashtags.length > 0 ? (
          <Text style={styles.tags} numberOfLines={1}>
            {item.hashtags.map((h) => `#${h}`).join(' ')}
          </Text>
        ) : null}
        {item.remixOfCreator ? (
          <Text style={styles.remixOf}>🔀 {t('feed.remixOf', { name: item.remixOfCreator })}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* felső mód-váltó */}
      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <View style={styles.modeRow}>
          <Pressable onPress={() => changeMode('following')}>
            <Text style={[styles.modeText, mode === 'following' && styles.modeActive]}>
              {t('feed.following')}
            </Text>
          </Pressable>
          <Text style={styles.modeSep}>|</Text>
          <Pressable onPress={() => changeMode('foryou')}>
            <Text style={[styles.modeText, mode === 'foryou' && styles.modeActive]}>
              {t('feed.forYou')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="videocam-outline" size={48} color={palette.border} />
          <Text style={styles.emptyText}>
            {mode === 'following' ? t('feed.emptyFollowing') : t('feed.empty')}
          </Text>
          <Pressable style={styles.emptyCta} onPress={() => router.push('/')}>
            <Text style={styles.emptyCtaText}>{t('feed.createCta')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={pageHeight}
          decelerationRate="fast"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
        />
      )}

      <BottomNav active="feed" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, alignItems: 'center' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6 },
  modeText: { color: '#ffffffaa', fontSize: 16, fontWeight: '700' },
  modeActive: { color: '#fff', textDecorationLine: 'underline' },
  modeSep: { color: '#ffffff66' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyText: { color: palette.textDim, fontSize: 15, textAlign: 'center' },
  emptyCta: {
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 6,
  },
  emptyCtaText: { color: '#fff', fontWeight: '800' },
  page: { justifyContent: 'flex-end' },
  centerTitle: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  centerEmoji: { fontSize: 56 },
  centerText: { color: '#ffffffdd', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 18 },
  railBtn: { alignItems: 'center', gap: 3 },
  railCount: { color: '#fff', fontSize: 12, fontWeight: '700' },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  followDot: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: palette.danger,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { position: 'absolute', left: 14, right: 84, gap: 5 },
  creator: { color: '#fff', fontSize: 16, fontWeight: '800' },
  captionText: { color: '#fff', fontSize: 14 },
  tags: { color: '#cbb8ff', fontSize: 13, fontWeight: '600' },
  remixOf: { color: '#ffffffcc', fontSize: 12, fontWeight: '600' },
});
