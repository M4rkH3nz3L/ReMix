import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { FlatList } from 'react-native';

import { resolveActiveId } from '@/lib/feedPager';
import type { FeedMode, FeedPost } from '@/types/social';
import { useRoles } from '@/store/roleStore';

/**
 * 📋 A feed adat- és kiválasztás-állapota (REFACTOR: a useFeed-ből, a hook-sorrend
 * változatlan): mód, channel-paraméterek, posztok, sheet-ek, aktív TOP-poszt, lap-indexek,
 * remixek, és a belőlük derivált aktív poszt.
 */
export function useFeedSelection() {
  const [mode, setMode] = useState<FeedMode>('foryou');
  // 📺 CHANNEL-mód: a feed EGY csatorna videóit lapozza (a rácsból megnyitva) —
  // `?channel=<userId>&start=<postId>`. Ilyenkor a mód-váltó helyett vissza-gomb megy.
  const params = useLocalSearchParams<{ channel?: string; start?: string }>();
  const channelId = typeof params.channel === 'string' && params.channel ? params.channel : undefined;
  const startId = typeof params.start === 'string' && params.start ? params.start : undefined;
  const [channelTitle, setChannelTitle] = useState('');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  // 🛡️ a blokkolt szerzők id-jei (kliens-oldali feed-szűrés); ref, hogy a `load`
  // ne induljon újra miatta, és a block-akció azonnal hasson a betöltött listára.
  const blockedIdsRef = useRef<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [commentFor, setCommentFor] = useState<FeedPost | null>(null);
  const [giftFor, setGiftFor] = useState<FeedPost | null>(null);
  const [collectionFor, setCollectionFor] = useState<FeedPost | null>(null);
  // 🛡️ globális poszt-moderátor jog → „eltávolítás a feedből" gomb bármely poszton
  const canModeratePost = useRoles((s) => s.permissions.includes('post.moderate'));
  // 📌 a FÜGGŐLEGESEN középre lapozott TOP-poszt; a vízszintes remix-lapozó EHHEZ
  // tartozik. Az aktívan LÁTSZÓ/JÁTSZÓ poszt (eredeti VAGY remix) a derivált `activeId`.
  const [activeTopId, setActiveTopId] = useState<string | null>(null);
  // az egyes TOP-posztok vízszintes lap-indexe (0 = eredeti, 1..N = a csatolt remixek)
  const [pageIndex, setPageIndex] = useState<Record<string, number>>({});
  // 🔀 az egyes posztokhoz CSATOLT remixek (lazy — csak az aktív poszté töltődik),
  // a poszton JOBBRA lapozható, full-screen remix-oldalakhoz
  const [remixMap, setRemixMap] = useState<Record<string, FeedPost[]>>({});
  // a vízszintes remix-lapozók (top-poszt id → FlatList) — a nyíl-gombos ugráshoz (web is)
  const listRefs = useRef<Map<string, FlatList<FeedPost>>>(new Map());
  // az aktívan látszó/játszó poszt: az aktív TOP-poszt kiválasztott lapja (0 = eredeti,
  // egyébként a megfelelő remix). EZ hajtja a videó-lejátszót és az overlay-eket.
  const activeRemixes = activeTopId ? remixMap[activeTopId] : undefined;
  const activeId = useMemo(
    () => resolveActiveId(activeTopId, pageIndex, activeRemixes),
    [activeTopId, pageIndex, activeRemixes]
  );
  // poszt keresése id alapján a top-listában ÉS a betöltött remixek közt (az aktív
  // poszt — ami lehet remix is — így kerül elő a videóhoz/overlay-ekhez)
  const findPost = useCallback(
    (id: string | null): FeedPost | undefined => {
      if (!id) {
        return undefined;
      }
      const top = posts.find((p) => p.id === id);
      if (top) {
        return top;
      }
      for (const list of Object.values(remixMap)) {
        const found = list.find((p) => p.id === id);
        if (found) {
          return found;
        }
      }
      return undefined;
    },
    [posts, remixMap]
  );
  const activePost = useMemo(() => findPost(activeId), [findPost, activeId]);
  const activeUri = activePost?.videoUri ?? null;
  // a FÜGGŐLEGES lista extraData-ja: a soroknak ÚJRA kell renderelniük, amikor az aktív
  // poszt VÁLT (videó) VAGY egy poszt remixei BETÖLTŐDNEK (a pager lapjai nőnek). A
  // FlatList PureComponent → e nélkül a lustán beérkező remixek nem jelennének meg a már
  // aktív poszton. Csak ezekre változik (nem a 200 ms-es progress-tickre) → nincs fölös
  // cella-újrarajz a videón.
  const listExtra = useMemo(() => ({ activeId, remixMap }), [activeId, remixMap]);

  return {
    mode,
    setMode,
    channelId,
    startId,
    channelTitle,
    setChannelTitle,
    posts,
    setPosts,
    blockedIdsRef,
    loading,
    setLoading,
    busy,
    setBusy,
    commentFor,
    setCommentFor,
    giftFor,
    setGiftFor,
    collectionFor,
    setCollectionFor,
    canModeratePost,
    activeTopId,
    setActiveTopId,
    pageIndex,
    setPageIndex,
    remixMap,
    setRemixMap,
    listRefs,
    activeId,
    findPost,
    activePost,
    activeUri,
    listExtra,
  };
}
