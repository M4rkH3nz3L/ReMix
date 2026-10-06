import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { createGenerationGuard } from '@/lib/asyncGuard';
import { remixAnalytics } from '@/lib/creatorAnalytics';
import { currentUserId, getChannel } from '@/lib/feed';
import { creatorTotals, type CreatorTotals } from '@/lib/promotion';
import type { FeedPost } from '@/types/social';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * 📈 Creator-dashboard — a saját csatorna aggregált mutatói (read-only): összesített
 * engagement ([promotion](@/lib/promotion) `creatorTotals`) + remix-analitika
 * ([creatorAnalytics](@/lib/creatorAnalytics) `remixAnalytics` a posztokból). A
 * saját csatornáról nyílik. Migráció-független (meglévő feed-adat).
 */
export default function DashboardScreen() {
  const { t } = useTranslation();
  const me = currentUserId();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [totals, setTotals] = useState<CreatorTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const guardRef = useRef(createGenerationGuard());

  useEffect(() => {
    if (!me) {
      return;
    }
    const guard = guardRef.current;
    const token = guard.begin();
    const timer = setTimeout(() => {
      if (!guard.isCurrent(token)) {
        return;
      }
      setLoading(true);
      Promise.all([getChannel(me), creatorTotals(me)])
        .then(([ch, tot]) => {
          if (guard.isCurrent(token)) {
            setPosts(ch.posts);
            setTotals(tot);
          }
        })
        .catch(() => {
          if (guard.isCurrent(token)) {
            setPosts([]);
            setTotals(null);
          }
        })
        .finally(() => {
          if (guard.isCurrent(token)) {
            setLoading(false);
          }
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [me]);

  const remix = useMemo(
    () => remixAnalytics(posts.map((p) => ({ id: p.id, views: p.counts.views, remixes: p.counts.remixes }))),
    [posts]
  );
  const titleById = useMemo(() => new Map(posts.map((p) => [p.id, p.title])), [posts]);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const stat = (icon: keyof typeof Ionicons.glyphMap, label: string, value: string) => (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={18} color={palette.accent} />
      <Text style={styles.statValue}>{value}</Text>
      {label ? <Text style={styles.statLabel}>{label}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('dashboard.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : !me || posts.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="stats-chart-outline" size={44} color={palette.border} />
          <Text style={styles.hint}>{t('dashboard.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={remix.topRemixed}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <View style={styles.statRow}>
                {stat('play', '', compact(totals?.views ?? 0))}
                {stat('heart', '', compact(totals?.likes ?? 0))}
                {stat('git-branch', '', compact(totals?.remixes ?? 0))}
              </View>
              <View style={styles.statRow}>
                {stat('repeat', t('dashboard.remixRate'), pct(remix.remixRate))}
                {stat('albums', t('dashboard.remixedShare'), pct(remix.remixedShare))}
              </View>
              {remix.topRemixed.length > 0 ? (
                <Text style={styles.section}>{t('dashboard.topRemixed')}</Text>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <Text style={styles.rank}>{index + 1}</Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {titleById.get(item.id) || item.id}
              </Text>
              <Text style={styles.rowCount}>🔀 {compact(item.remixes)}</Text>
            </View>
          )}
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
  hint: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
  list: { padding: 12, paddingBottom: 24 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: {
    flex: 1,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { color: palette.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: palette.textDim, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  section: { color: palette.text, fontSize: 14, fontWeight: '800', marginTop: 8, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rank: { color: palette.textDim, fontSize: 13, fontWeight: '800', width: 20 },
  rowTitle: { flex: 1, color: palette.text, fontSize: 14 },
  rowCount: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
});
