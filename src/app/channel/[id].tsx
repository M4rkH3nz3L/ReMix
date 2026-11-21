import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { GiftSheet } from '@/components/GiftSheet';
import { createChannelActions } from '@/components/channel/channelActions';
import { ChannelGridItem } from '@/components/channel/ChannelGridItem';
import { ChannelProfileHeader } from '@/components/channel/ChannelProfileHeader';
import { PromoteSheet, RemixModerationSheet } from '@/components/channel/ChannelSheets';
import { ChannelTopBar } from '@/components/channel/ChannelTopBar';
import { palette } from '@/constants/editor';
import { channelNames } from '@/lib/channelScreen';
import { getChannel, type ChannelData } from '@/lib/feed';
import { getLiveByHost, type LiveSession } from '@/lib/live';
import { creatorTotals, type CreatorTotals } from '@/lib/promotion';
import type { FeedPost } from '@/types/social';
import { logCaught } from '@/lib/logCaught';

/**
 * 📺 Egy alkotó csatornája: profil-fej, poszt-rács, követés, kiemelés, remix-felügyelet.
 * REFACTOR: a gyökér az állapotot, a betöltést és a lista-vázat tartja; a részek a
 * src/components/channel/ alatt, a tiszta számítások a src/lib/channelScreen.ts-ben.
 */
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
      .catch((caught) => { logCaught('app/channel/[id].tsx:load', caught); });
    getChannel(id)
      .then((d) => {
        setData(d);
        setFollowing(d.isFollowing);
        setFollowers(d.followers);
      })
      .catch((caught) => { logCaught('app/channel/[id].tsx:load', caught); });
    creatorTotals(id)
      .then(setTotals)
      .catch((caught) => { logCaught('app/channel/[id].tsx:load', caught); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const { onFollow, onMessage, openPost, doModerate, doPromote, openInFeed } = createChannelActions({
    t,
    id,
    data,
    following,
    promoteFor,
    busy,
    budget,
    cpv,
    load,
    setFollowing,
    setFollowers,
    setPromoteFor,
    setBusy,
    setRemixFor,
    setRemixes,
    setRemixLoading,
  });

  const { username, displayName } = channelNames(data, id);

  const gridItem = ({ item }: { item: FeedPost }) => (
    <ChannelGridItem item={item} isMe={data?.isMe} openInFeed={openInFeed} openPost={openPost} />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ChannelTopBar username={username} />

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
            <ChannelProfileHeader
              data={data}
              username={username}
              displayName={displayName}
              liveSession={liveSession}
              followers={followers}
              totals={totals}
              following={following}
              onFollow={onFollow}
              onMessage={onMessage}
              onGift={() => setGiftOpen(true)}
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('channel.noPosts')}</Text>}
        />
      )}

      <PromoteSheet
        promoteFor={promoteFor}
        setPromoteFor={setPromoteFor}
        budget={budget}
        setBudget={setBudget}
        cpv={cpv}
        setCpv={setCpv}
        busy={busy}
        doPromote={doPromote}
      />

      {/* 🎁 ajándék küldése ennek a creatornak (TikTok-modell) */}
      <GiftSheet
        visible={giftOpen}
        toUsername={username}
        toName={displayName}
        onClose={() => setGiftOpen(false)}
      />

      <RemixModerationSheet
        remixFor={remixFor}
        setRemixFor={setRemixFor}
        remixLoading={remixLoading}
        remixes={remixes}
        doModerate={doModerate}
      />

      <BottomNav active="channel" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gridRow: { gap: 3, paddingHorizontal: 3 },
  empty: { color: palette.textDim, textAlign: 'center', paddingVertical: 40 },
});
