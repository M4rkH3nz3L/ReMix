import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { VideoThumb } from '@/components/VideoThumb';
import { palette } from '@/constants/editor';
import { createGenerationGuard } from '@/lib/asyncGuard';
import { searchFeed, type SearchResults } from '@/lib/feed';
import type { Creator, FeedPost } from '@/types/social';

/** rövid szám (1.2k / 3.4M) — mint a feedben */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const EMPTY: SearchResults = { posts: [], creators: [] };

/**
 * 🔎 Keresés-képernyő — a feed felső sorának kereső-ikonja nyitja. Cím / alkotó /
 * hashtag szerint keres a nyilvános feedben (debounce-olva), és „Alkotók" +
 * „Videók" szekcióban jeleníti meg a találatot. A videó a csatorna-feedben nyílik
 * (ugyanaz az útvonal, mint a csatorna-rácsból).
 */
export default function SearchScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  // a késve beérő válaszokat eldobjuk (a legutolsó lekérés győz) — közös util (§12.5)
  const guardRef = useRef(createGenerationGuard());

  // debounce-olt keresés. Minden állapot-írás a késleltetett callbackben történik
  // (nem az effekt törzsében szinkron) — így nincs kaszkádoló újrarender. Üres
  // lekérdezésnél 0 ms-mal azonnal ürítünk; egyébként 300 ms után keresünk.
  useEffect(() => {
    const q = query.trim();
    const token = guardRef.current.begin();
    const guard = guardRef.current;
    const timer = setTimeout(
      () => {
        if (!guard.isCurrent(token)) {
          return;
        }
        if (!q) {
          setResults(EMPTY);
          setLoading(false);
          return;
        }
        setLoading(true);
        searchFeed(q)
          .then((r) => {
            if (guard.isCurrent(token)) {
              setResults(r);
            }
          })
          .catch(() => {
            if (guard.isCurrent(token)) {
              setResults(EMPTY);
            }
          })
          .finally(() => {
            if (guard.isCurrent(token)) {
              setLoading(false);
            }
          });
      },
      q ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const hasResults = results.posts.length > 0 || results.creators.length > 0;

  const openVideo = (post: FeedPost) =>
    router.push(`/?channel=${post.creator.id}&start=${post.id}`);
  const openCreator = (c: Creator) => router.push(`/channel/${c.id}`);

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

  const creatorsHeader =
    results.creators.length > 0 ? (
      <View style={styles.creatorsSection}>
        <Text style={styles.sectionTitle}>{t('search.creators')}</Text>
        <FlatList
          horizontal
          data={results.creators}
          keyExtractor={(c) => c.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.creatorsRow}
          renderItem={({ item }) => (
            <Pressable style={styles.creatorCard} onPress={() => openCreator(item)}>
              <View style={styles.avatar}>
                {item.avatarUri ? (
                  <Image source={{ uri: item.avatarUri }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>
                    {(item.displayName || '?').slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.creatorName} numberOfLines={1}>
                @{item.username}
              </Text>
            </Pressable>
          )}
        />
        {results.posts.length > 0 ? (
          <Text style={[styles.sectionTitle, styles.videosTitle]}>{t('search.videos')}</Text>
        ) : null}
      </View>
    ) : null;

  const renderBody = () => {
    if (!trimmed) {
      return (
        <View style={styles.center}>
          <Ionicons name="search" size={44} color={palette.border} />
          <Text style={styles.hint}>{t('search.empty')}</Text>
        </View>
      );
    }
    if (loading && !hasResults) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      );
    }
    if (!hasResults) {
      return (
        <View style={styles.center}>
          <Ionicons name="sad-outline" size={44} color={palette.border} />
          <Text style={styles.hint}>{t('search.noResults', { q: trimmed })}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={results.posts}
        key="grid3"
        numColumns={3}
        keyExtractor={(p) => p.id}
        renderItem={gridItem}
        ListHeaderComponent={creatorsHeader}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={palette.textDim} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor={palette.textDim}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={palette.accent}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel={t('search.clear')}>
              <Ionicons name="close-circle" size={18} color={palette.textDim} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {renderBody()}
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
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  input: { flex: 1, color: palette.text, fontSize: 15, padding: 0 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  hint: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  list: { paddingBottom: 24 },
  creatorsSection: { paddingTop: 12 },
  sectionTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  videosTitle: { marginTop: 16 },
  creatorsRow: { gap: 14, paddingHorizontal: 12, paddingBottom: 4 },
  creatorCard: { width: 68, alignItems: 'center', gap: 5 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  creatorName: { color: palette.textDim, fontSize: 11, fontWeight: '700', maxWidth: 68 },

  gridRow: { gap: 3, paddingHorizontal: 3 },
  gridItem: {
    flex: 1 / 3,
    aspectRatio: 0.62,
    marginBottom: 3,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridViews: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  gridViewsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
