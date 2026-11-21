import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { getChannel, listFeed } from '@/lib/feed';
import { filterBlocked, listMyBlockedIds } from '@/lib/blocks';
import type { FeedMode, FeedPost } from '@/types/social';
import { logCaught } from '@/lib/logCaught';

/** 📥 A feed betöltése (mód / channel) + a saját blokk-lista (REFACTOR: a useFeed-ből, a hook-sorrend változatlan). */
export function useFeedLoader({
  mode,
  channelId,
  startId,
  setChannelTitle,
  setPosts,
  setActiveTopId,
  setLoading,
  blockedIdsRef,
}: {
  mode: FeedMode;
  channelId: string | undefined;
  startId: string | undefined;
  setChannelTitle: Dispatch<SetStateAction<string>>;
  setPosts: Dispatch<SetStateAction<FeedPost[]>>;
  setActiveTopId: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  blockedIdsRef: MutableRefObject<string[]>;
}) {
  const load = useCallback(
    (m: FeedMode) => {
      // channel-mód: EGY csatorna posztjai; egyébként a normál feed
      const req = channelId
        ? getChannel(channelId).then((d) => {
            setChannelTitle(d.creator?.username ?? '');
            return d.posts;
          })
        : listFeed(m);
      req
        .then((rawList) => {
          // a blokkolt szerzők posztjait kiszűrjük (a filterBlocked pure + tesztelt)
          const list = filterBlocked(rawList, (p) => p.creator.id, blockedIdsRef.current);
          setPosts(list);
          // ⚡ az első elem AZONNAL aktív legyen — különben a lista „rajtra marad":
          // az első videó a viewability-eseményig nem indul be. Channel-módban a
          // MEGNYITOTT posztnál kezdünk; egyébként érvényes meglévő aktívat megtartunk.
          setActiveTopId((prev) => {
            if (channelId && startId && list.some((x) => x.id === startId)) {
              return startId;
            }
            return prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null);
          });
        })
        .catch((caught) => {
        logCaught('hooks/useFeed.ts:load', caught);
          setPosts([]);
          setActiveTopId(null);
        })
        .finally(() => setLoading(false));
    },
    [channelId, startId, blockedIdsRef, setActiveTopId, setChannelTitle, setLoading, setPosts]
  );

  useEffect(() => {
    load(mode);
  }, [load, mode]);

  // 🛡️ a saját blokk-lista betöltése (egyszer) → a már megjelenített feedből is
  // kiszűrjük a blokkolt szerzőket (a block máshonnan is érkezhetett).
  useEffect(() => {
    listMyBlockedIds()
      .then((ids) => {
        blockedIdsRef.current = ids;
        if (ids.length > 0) {
          setPosts((prev) => filterBlocked(prev, (p) => p.creator.id, ids));
        }
      })
      .catch((caught) => {
      logCaught('hooks/useFeed.ts:useFeed', caught);
        /* nem bejelentkezve / nincs backend → nincs blokk-szűrés */
      });
  }, [blockedIdsRef, setPosts]);
}
