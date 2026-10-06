import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VideoThumb } from '@/components/VideoThumb';
import { palette } from '@/constants/editor';
import { createGenerationGuard } from '@/lib/asyncGuard';
import { listPostsByHashtag } from '@/lib/feed';
import { canonicalTag } from '@/lib/hashtags';
import type { FeedPost } from '@/types/social';

/** rövid szám (1.2k / 3.4M) — mint a feedben/keresőben */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * #️⃣ Hashtag-oldal — egy `#tag` publikus posztjai rácsban. A feedből/keresőből a
 * hashtagre koppintva nyílik (`/hashtag/<tag>`). A lekérés a [feed](@/lib/feed)
 * `listPostsByHashtag`-je; a cím-normalizálás a [hashtags](@/lib/hashtags) magból.
 */
export default function HashtagScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ tag?: string }>();
  const rawTag = Array.isArray(params.tag) ? params.tag[0] : params.tag ?? '';
  const display = canonicalTag(rawTag) ?? `#${rawTag}`;

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const guardRef = useRef(createGenerationGuard());

  // A state-írásokat a (nem szinkron) timer-callbackben végezzük — így nincs
  // kaszkádoló újrarender az effekt törzséből (lásd search.tsx; react-compiler lint).
  useEffect(() => {
    const guard = guardRef.current;
    const token = guard.begin();
    const timer = setTimeout(() => {
      if (!guard.isCurrent(token)) {
        return;
      }
      setLoading(true);
      listPostsByHashtag(rawTag)
        .then((r) => {
          if (guard.isCurrent(token)) {
            setPosts(r);
          }
        })
        .catch(() => {
          if (guard.isCurrent(token)) {
            setPosts([]);
          }
        })
        .finally(() => {
          if (guard.isCurrent(token)) {
            setLoading(false);
          }
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [rawTag]);

  const openVideo = (post: FeedPost) => router.push(`/?channel=${post.creator.id}&start=${post.id}`);

  const gridItem = ({ item }: { item: FeedPost }) => (
    <VideoThumb
      style={styles.gridItem}
      videoUri={item.videoUri}
      posterUri={item.posterUri}
      onPress={() => openVideo(item)}
      label={item.title}
    >
      <View style={styles.gridViews}>
        <Ionicons name="play" size={11} color="#fff" />
        <Text style={styles.gridViewsText}>{compact(item.counts.views)}</Text>
      </View>
    </VideoThumb>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {display}
        </Text>
      </View>

      {loading && posts.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="pricetag-outline" size={44} color={palette.border} />
          <Text style={styles.hint}>{t('search.noResults', { q: display })}</Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          key="grid3"
          numColumns={3}
          keyExtractor={(p) => p.id}
          renderItem={gridItem}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, color: palette.text, fontSize: 18, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  hint: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  list: { paddingBottom: 24 },
  gridRow: { gap: 3, paddingHorizontal: 3 },
  gridItem: {
    flex: 1 / 3,
    aspectRatio: 0.62,
    marginBottom: 3,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridViews: { position: 'absolute', left: 5, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridViewsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
