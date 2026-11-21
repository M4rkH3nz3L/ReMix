import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { openDm } from '@/lib/chat';
import { promoteBudget, promoteCostPerView } from '@/lib/channelScreen';
import {
  deletePost,
  listRemixesOf,
  moderateRemix,
  remixFromPost,
  toggleFollow,
  type ChannelData,
} from '@/lib/feed';
import { canRemix, remixRoute } from '@/lib/imageRemix';
import { logCaught } from '@/lib/logCaught';
import { runOptimistic } from '@/lib/optimistic';
import { postPromotion, promotePost } from '@/lib/promotion';
import { InsufficientCreditsError } from '@/lib/shop';
import { requireApp } from '@/lib/webGate';
import type { FeedPost } from '@/types/social';

/**
 * A csatorna-képernyő hook nélküli akció-gyára (REFACTOR: a src/app/channel/[id].tsx-ből):
 * követés, DM, statisztika, remix-felügyelet, saját poszt kezelése, kiemelés. A
 * logCaught-címkék az eredeti fájl ujjlenyomatai — változatlanok.
 */
export interface ChannelActionDeps {
  t: TFunction;
  id: string | undefined;
  data: ChannelData | null;
  following: boolean;
  promoteFor: FeedPost | null;
  busy: boolean;
  budget: string;
  cpv: string;
  load: () => void;
  setFollowing: Dispatch<SetStateAction<boolean>>;
  setFollowers: Dispatch<SetStateAction<number>>;
  setPromoteFor: Dispatch<SetStateAction<FeedPost | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setRemixFor: Dispatch<SetStateAction<FeedPost | null>>;
  setRemixes: Dispatch<SetStateAction<FeedPost[]>>;
  setRemixLoading: Dispatch<SetStateAction<boolean>>;
}

export function createChannelActions({
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
}: ChannelActionDeps) {
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
      .catch((e: unknown) => { logCaught('app/channel/[id].tsx:onMessage', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); });
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
      .catch((caught) => { logCaught('app/channel/[id].tsx:showStats', caught); });
  };

  const openRemixMod = (post: FeedPost) => {
    setRemixFor(post);
    setRemixLoading(true);
    setRemixes([]);
    listRemixesOf(post.id)
      .then(setRemixes)
      .catch((caught) => { logCaught('app/channel/[id].tsx:openRemixMod', caught); return setRemixes([]); })
      .finally(() => setRemixLoading(false));
  };

  // egy remix feed-láthatóságának moderálása (soft removed/ok) — optimista
  const doModerate = (remix: FeedPost, status: 'removed' | 'ok') => {
    setRemixes((prev) =>
      prev.map((r) => (r.id === remix.id ? { ...r, moderationStatus: status } : r))
    );
    moderateRemix(remix.id, status).catch((e: unknown) => {
      logCaught('app/channel/[id].tsx:doModerate', e);
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
        onPress: () => deletePost(post.id).then(load).catch((caught) => { logCaught('app/channel/[id].tsx:openPost', caught); }),
      });
      buttons.push({ text: t('common.cancel'), style: 'cancel' });
      Alert.alert(post.title, undefined, buttons);
      return;
    }
    if (canRemix(post)) {
      Alert.alert(post.title, t('feed.remixPrompt'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('feed.remix'),
          onPress: () =>
            requireApp() &&
            remixFromPost(post).then((pid) => {
              if (pid) {
                router.push(remixRoute(post, pid) as Href);
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
    const b = promoteBudget(budget);
    const c = promoteCostPerView(cpv);
    setBusy(true);
    promotePost(promoteFor.id, b, c)
      .then((r) => {
        setPromoteFor(null);
        Alert.alert(t('promote.cta'), t('promote.done', { views: r.viewsTarget }));
        load();
      })
      .catch((e: unknown) => {
      logCaught('app/channel/[id].tsx:doPromote', e);
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

  // videóra koppintás → a csatorna videóit lapozó feed a megnyitott posztnál
  const openInFeed = (post: FeedPost) => {
    router.push(`/?channel=${id}&start=${post.id}`);
  };

  return { onFollow, onMessage, openPost, doModerate, doPromote, openInFeed };
}
