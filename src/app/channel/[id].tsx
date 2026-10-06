import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { GiftSheet } from '@/components/GiftSheet';
import { CreatorBadges, TagBadges } from '@/components/profile/CreatorControls';
import { PrimaryButton } from '@/components/ui/controls';
import { VideoThumb } from '@/components/VideoThumb';
import { COVER_ASPECT, palette } from '@/constants/editor';
import {
  deletePost,
  getChannel,
  listRemixesOf,
  moderateRemix,
  remixFromPost,
  toggleFollow,
  type ChannelData,
} from '@/lib/feed';
import { openDm } from '@/lib/chat';
import { getLiveByHost, type LiveSession } from '@/lib/live';
import { runOptimistic } from '@/lib/optimistic';
import { InsufficientCreditsError } from '@/lib/shop';
import {
  creatorTotals,
  postPromotion,
  promotePost,
  type CreatorTotals,
} from '@/lib/promotion';
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
  const [totals, setTotals] = useState<CreatorTotals | null>(null);
  const [promoteFor, setPromoteFor] = useState<FeedPost | null>(null);
  const [budget, setBudget] = useState('50');
  const [cpv, setCpv] = useState('1');
  const [busy, setBusy] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [remixFor, setRemixFor] = useState<FeedPost | null>(null);
  const [remixes, setRemixes] = useState<FeedPost[]>([]);
  const [remixLoading, setRemixLoading] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);

  const load = useCallback(() => {
    if (!id) {
      return;
    }
    // 🔴 él-e épp a csatorna tulajdonosa? (LIVE-jelző + tap-to-watch)
    getLiveByHost(id)
      .then(setLiveSession)
      .catch(() => {});
    getChannel(id)
      .then((d) => {
        setData(d);
        setFollowing(d.isFollowing);
        setFollowers(d.followers);
      })
      .catch(() => {});
    creatorTotals(id)
      .then(setTotals)
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
    // ⚡ §12.4: optimista követés-váltás + VISSZAGÖRGETÉS hibánál (korábban a
    // `.catch(() => {})` elnyelte a hibát → a UI tévesen „követed"-et mutatott).
    void runOptimistic({
      apply: () => {
        setFollowing(next);
        setFollowers((n) => n + (next ? 1 : -1));
      },
      rollback: () => {
        setFollowing(!next);
        setFollowers((n) => n + (next ? -1 : 1));
      },
      commit: () => toggleFollow(id, next),
    });
  };

  // 💬 közvetlen üzenet a csatorna tulajának (DM megnyitás/létrehozás)
  const onMessage = () => {
    if (!id) {
      return;
    }
    openDm(id)
      .then((convId) => router.push(`/chat/${convId}`))
      .catch((e: unknown) => Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)));
  };

  const showStats = (post: FeedPost) => {
    postPromotion(post.id)
      .then((promo) => {
        const lines = [
          t('stats.views', { n: post.counts.views }),
          t('stats.likes', { n: post.counts.likes }),
          t('stats.saves', { n: post.counts.saves }),
          t('stats.comments', { n: post.counts.comments }),
          t('stats.remixes', { n: post.counts.remixes }),
        ];
        if (promo) {
          lines.push(
            '',
            t('stats.promoLine', {
              delivered: promo.viewsDelivered,
              target: promo.viewsTarget,
              spent: promo.spentCredits,
            }),
            t(`promote.status_${promo.status}`)
          );
        }
        Alert.alert(t('stats.title'), lines.join('\n'));
      })
      .catch(() => {});
  };

  const openRemixMod = (post: FeedPost) => {
    setRemixFor(post);
    setRemixLoading(true);
    setRemixes([]);
    listRemixesOf(post.id)
      .then(setRemixes)
      .catch(() => setRemixes([]))
      .finally(() => setRemixLoading(false));
  };

  // egy remix feed-láthatóságának moderálása (soft removed/ok) — optimista
  const doModerate = (remix: FeedPost, status: 'removed' | 'ok') => {
    setRemixes((prev) =>
      prev.map((r) => (r.id === remix.id ? { ...r, moderationStatus: status } : r))
    );
    moderateRemix(remix.id, status).catch((e: unknown) => {
      // visszagörgetés hibánál
      setRemixes((prev) =>
        prev.map((r) =>
          r.id === remix.id ? { ...r, moderationStatus: remix.moderationStatus } : r
        )
      );
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    });
  };

  const openPost = (post: FeedPost) => {
    if (data?.isMe) {
      // saját poszt → kezelés: kiemelés / statisztika / (lejátszás) / törlés
      const buttons: {
        text: string;
        style?: 'cancel' | 'destructive';
        onPress?: () => void;
      }[] = [
        { text: t('promote.cta'), onPress: () => setPromoteFor(post) },
        { text: t('stats.title'), onPress: () => showStats(post) },
      ];
      if (post.projectId) {
        buttons.push({ text: t('feed.remix'), onPress: () => router.push(`/player/${post.projectId}`) });
      }
      if (post.counts.remixes > 0) {
        buttons.push({
          text: t('channel.remixMod.cta', { n: post.counts.remixes }),
          onPress: () => openRemixMod(post),
        });
      }
      buttons.push({
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deletePost(post.id).then(load).catch(() => {}),
      });
      buttons.push({ text: t('common.cancel'), style: 'cancel' });
      Alert.alert(post.title, undefined, buttons);
      return;
    }
    if (post.remixable && post.videoUri) {
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

  const doPromote = () => {
    if (!promoteFor || busy) {
      return;
    }
    const b = parseInt(budget, 10) || 0;
    const c = Math.max(1, parseInt(cpv, 10) || 1);
    setBusy(true);
    promotePost(promoteFor.id, b, c)
      .then((r) => {
        setPromoteFor(null);
        Alert.alert(t('promote.cta'), t('promote.done', { views: r.viewsTarget }));
        load();
      })
      .catch((e: unknown) => {
        if (e instanceof InsufficientCreditsError) {
          Alert.alert(t('shop.needCreditsTitle'), t('shop.needCreditsBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('shop.buyCredits'), onPress: () => router.push('/shop') },
          ]);
        } else {
          Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => setBusy(false));
  };

  const targetViews = (() => {
    const b = parseInt(budget, 10) || 0;
    const c = Math.max(1, parseInt(cpv, 10) || 1);
    return Math.floor(b / c);
  })();

  const username = data?.creator?.username ?? (id ?? '').slice(0, 8);
  // ⚠️ NE a „Csatorna" (nav-címke) legyen a név, ha nincs creator — inkább a handle
  const displayName = data?.creator?.displayName || username;

  // videóra koppintás → a csatorna videóit lapozó feed a megnyitott posztnál
  const openInFeed = (post: FeedPost) => {
    router.push(`/?channel=${id}&start=${post.id}`);
  };

  const gridItem = ({ item }: { item: FeedPost }) => (
    <VideoThumb
      style={styles.gridItem}
      videoUri={item.videoUri}
      posterUri={item.posterUri}
      onPress={() => openInFeed(item)}
      label={item.title}
    >
      <View style={styles.gridViews}>
        <Ionicons name="play" size={11} color="#fff" />
        <Text style={styles.gridViewsText}>{compact(item.counts.views)}</Text>
      </View>
      {/* saját poszt → kezelés (kiemelés/statisztika/remix-mod/törlés) a sarok-gombbal */}
      {data?.isMe ? (
        <Pressable style={styles.gridManage} onPress={() => openPost(item)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={16} color="#fff" />
        </Pressable>
      ) : null}
    </VideoThumb>
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
              {data?.coverUri ? (
                <Image source={{ uri: data.coverUri }} style={styles.cover} contentFit="cover" />
              ) : (
                <View style={[styles.cover, styles.coverPlaceholder]} />
              )}
              <View style={styles.bigAvatar}>
                {data?.creator?.avatarUri ? (
                  <Image
                    source={{ uri: data.creator.avatarUri }}
                    style={styles.bigAvatarImg}
                    contentFit="cover"
                  />
                ) : (
                  <Text style={styles.bigAvatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <Text style={styles.displayName}>{displayName}</Text>
              <Text style={styles.handle}>@{username}</Text>
              {liveSession ? (
                <Pressable style={styles.liveBanner} onPress={() => router.push(`/live/${liveSession.id}`)}>
                  <View style={styles.liveBannerDot} />
                  <Ionicons name="radio" size={15} color="#fff" />
                  <Text style={styles.liveBannerText} numberOfLines={1}>
                    {t('channel.liveNow', { defaultValue: 'LIVE now — tap to watch' })}
                  </Text>
                </Pressable>
              ) : null}
              {data?.creatorTypes?.length ? (
                <View style={styles.creatorBadges}>
                  <CreatorBadges types={data.creatorTypes} />
                </View>
              ) : null}
              {data?.bio ? <Text style={styles.bio}>{data.bio}</Text> : null}
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
              {totals ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsText}>
                    ▶ {compact(totals.views)} · ♥ {compact(totals.likes)} · 🔀 {compact(totals.remixes)}
                  </Text>
                </View>
              ) : null}
              {data?.isMe ? (
                <View style={styles.actionRow}>
                  <Pressable style={styles.editBtn} onPress={() => router.push('/profile')}>
                    <Ionicons name="settings-outline" size={16} color={palette.text} />
                    <Text style={styles.editBtnText}>{t('channel.editProfile')}</Text>
                  </Pressable>
                  <Pressable style={styles.editBtn} onPress={() => router.push('/collections')}>
                    <Ionicons name="folder-outline" size={16} color={palette.text} />
                    <Text style={styles.editBtnText}>{t('collections.title')}</Text>
                  </Pressable>
                  <Pressable style={styles.editBtn} onPress={() => router.push('/dashboard')}>
                    <Ionicons name="stats-chart-outline" size={16} color={palette.text} />
                    <Text style={styles.editBtnText}>{t('dashboard.title')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.followBtn, following && styles.followingBtn]}
                    onPress={onFollow}
                  >
                    <Text style={[styles.followBtnText, following && styles.followingBtnText]}>
                      {following ? t('channel.following2') : t('channel.follow')}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.msgBtn} onPress={onMessage} accessibilityLabel={t('chat.message')}>
                    <Ionicons name="chatbubble-outline" size={18} color={palette.text} />
                  </Pressable>
                  <Pressable
                    style={styles.msgBtn}
                    onPress={() => setGiftOpen(true)}
                    accessibilityLabel={t('wallet.gift.title')}
                  >
                    <Ionicons name="gift-outline" size={18} color={palette.accent2} />
                  </Pressable>
                </View>
              )}
              {data?.skills?.length ? (
                <View style={styles.skillsWrap}>
                  <TagBadges tags={data.skills} max={12} />
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('channel.noPosts')}</Text>}
        />
      )}

      {/* — kiemelés (promóció) modal — */}
      <Modal
        visible={promoteFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPromoteFor(null)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPromoteFor(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('promote.cta')}</Text>
            <Text style={styles.sheetHint}>{t('promote.hint')}</Text>
            <Text style={styles.fieldLabel}>{t('promote.budget')}</Text>
            <TextInput
              style={styles.input}
              value={budget}
              onChangeText={setBudget}
              keyboardType="number-pad"
              placeholderTextColor={palette.textDim}
            />
            <Text style={styles.fieldLabel}>{t('promote.costPerView')}</Text>
            <TextInput
              style={styles.input}
              value={cpv}
              onChangeText={setCpv}
              keyboardType="number-pad"
              placeholderTextColor={palette.textDim}
            />
            <Text style={styles.targetText}>{t('promote.target', { views: targetViews })}</Text>
            <View style={{ marginTop: 10 }}>
              <PrimaryButton
                label={t('promote.confirm', { budget: parseInt(budget, 10) || 0 })}
                icon="megaphone-outline"
                onPress={doPromote}
                disabled={busy || targetViews < 1}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 🎁 ajándék küldése ennek a creatornak (TikTok-modell) */}
      <GiftSheet
        visible={giftOpen}
        toUsername={username}
        toName={displayName}
        onClose={() => setGiftOpen(false)}
      />

      {/* — 🔀 remix-felügyelet modal (az eredeti tulaj moderálja a remixeket) — */}
      <Modal
        visible={remixFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRemixFor(null)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRemixFor(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('channel.remixMod.title')}</Text>
            <Text style={styles.sheetHint}>{t('channel.remixMod.hint')}</Text>
            {remixLoading ? (
              <ActivityIndicator color={palette.accent} style={{ marginVertical: 24 }} />
            ) : remixes.length === 0 ? (
              <Text style={styles.remixEmpty}>{t('channel.remixMod.empty')}</Text>
            ) : (
              <FlatList
                data={remixes}
                keyExtractor={(r) => r.id}
                style={{ maxHeight: 340 }}
                renderItem={({ item }) => {
                  const removed = item.moderationStatus === 'removed';
                  return (
                    <Pressable
                      style={styles.remixRow}
                      onPress={() => router.push(`/channel/${item.creator.id}`)}
                    >
                      <View style={styles.remixInfo}>
                        <Text style={styles.remixTitle} numberOfLines={1}>
                          @{item.creator.username}
                        </Text>
                        <Text style={styles.remixSub} numberOfLines={1}>
                          {removed ? t('channel.remixMod.removedLabel') : item.title}
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.remixBtn, removed ? styles.remixRestore : styles.remixRemove]}
                        onPress={() => doModerate(item, removed ? 'ok' : 'removed')}
                        hitSlop={6}
                      >
                        <Text style={styles.remixBtnText}>
                          {removed ? t('channel.remixMod.restore') : t('channel.remixMod.remove')}
                        </Text>
                      </Pressable>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

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
  cover: { alignSelf: 'stretch', aspectRatio: COVER_ASPECT, borderRadius: 14, backgroundColor: palette.surfaceHigh },
  coverPlaceholder: { borderWidth: 1, borderColor: palette.border },
  bigAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: palette.bg,
    marginTop: -48,
  },
  bigAvatarImg: { width: '100%', height: '100%' },
  bigAvatarText: { color: '#fff', fontSize: 40, fontWeight: '800' },
  displayName: { color: palette.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  handle: { color: palette.textDim, fontSize: 14 },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
  },
  liveBannerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  liveBannerText: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  creatorBadges: { marginTop: 8, paddingHorizontal: 16 },
  bio: { color: palette.text, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, paddingHorizontal: 24 },
  skillsWrap: { marginTop: 14, paddingHorizontal: 16, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 28, marginTop: 12 },
  stat: { alignItems: 'center' },
  statNum: { color: palette.text, fontSize: 17, fontWeight: '800' },
  statLabel: { color: palette.textDim, fontSize: 12 },
  followBtn: {
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 40,
    paddingVertical: 10,
  },
  followingBtn: { backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  followingBtnText: { color: palette.text },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  msgBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  gridManage: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridViews: { position: 'absolute', left: 5, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridViewsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { color: palette.textDim, textAlign: 'center', paddingVertical: 40 },
  totalsRow: { marginTop: 10, backgroundColor: palette.surfaceHigh, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  totalsText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  sheetTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  sheetHint: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  fieldLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
  targetText: { color: palette.accent, fontSize: 14, fontWeight: '700', marginTop: 8 },
  remixEmpty: { color: palette.textDim, textAlign: 'center', paddingVertical: 24 },
  remixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  remixInfo: { flex: 1 },
  remixTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
  remixSub: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  remixBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  remixRemove: { backgroundColor: palette.danger },
  remixRestore: { backgroundColor: palette.accent },
  remixBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});

