import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { VideoPlayer } from 'expo-video';
import { Platform, type FlatList, type ViewToken } from 'react-native';

import { listRemixesOf, recordView, recordViewEvent } from '@/lib/feed';
import { visibleRemixes } from '@/lib/feedPager';
import type { FeedPost } from '@/types/social';
import { logCaught } from '@/lib/logCaught';
import { hotspotsOf } from '@/hooks/feed/feedFormat';

/**
 * 🎯 Az AKTÍV poszt életciklusa (REFACTOR: a useFeed-ből, a hook- és effekt-sorrend
 * változatlan): függőleges lapozás (onViewable), megtekintés-rögzítés, lejátszás-indítás,
 * hotspot-időzítés, haladás-követés és a remixek lusta betöltése.
 */
export function useActivePostEffects({
  setActiveTopId,
  setProgress,
  setHotspotTime,
  seekingRef,
  setPageIndex,
  listRefs,
  activeId,
  findPost,
  activeUri,
  player,
  isFocused,
  activeVideoElRef,
  mutedRef,
  volumeRef,
  activePost,
  setClock,
  activeTopId,
  posts,
  remixMap,
  setRemixMap,
}: {
  setActiveTopId: Dispatch<SetStateAction<string | null>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setHotspotTime: Dispatch<SetStateAction<number>>;
  seekingRef: MutableRefObject<boolean>;
  setPageIndex: Dispatch<SetStateAction<Record<string, number>>>;
  listRefs: MutableRefObject<Map<string, FlatList<FeedPost>>>;
  activeId: string | null;
  findPost: (id: string | null) => FeedPost | undefined;
  activeUri: string | null;
  player: VideoPlayer;
  isFocused: boolean;
  activeVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  mutedRef: MutableRefObject<boolean>;
  volumeRef: MutableRefObject<number>;
  activePost: FeedPost | undefined;
  setClock: Dispatch<SetStateAction<{ cur: number; dur: number }>>;
  activeTopId: string | null;
  posts: FeedPost[];
  remixMap: Record<string, FeedPost[]>;
  setRemixMap: Dispatch<SetStateAction<Record<string, FeedPost[]>>>;
}) {
  const viewedRef = useRef<Set<string>>(new Set());
  // FÜGGŐLEGES lapozás: a középre kerülő TOP-poszt lesz aktív (a vízszintes lap-indexét
  // a `pageIndex` őrzi, így visszalapozva ott folytatja, ahol elhagytuk)
  const onViewable = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems[0]?.item as FeedPost | undefined;
    if (first) {
      setActiveTopId(first.id);
      // 🔄 lapozás → a POSZTHOZ kötött UI azonnal nullázódik (haladás + hotspot-idő),
      // hogy az új videó ne az előző poszt állapotával villanjon fel
      setProgress(0);
      setHotspotTime(0);
      seekingRef.current = false;
      // a középre lapozott poszt az EREDETIRŐL induljon (0. lap) — így a videó és a
      // látszó lap sosem csúszik szét, ha a listát a windowing közben újra-mountolta
      setPageIndex((prev) => (prev[first.id] ? { ...prev, [first.id]: 0 } : prev));
      listRefs.current.get(first.id)?.scrollToOffset({ offset: 0, animated: false });
    }
  }).current;

  // az aktív videó utolsó ismert pozíciója: a felszabadult lejátszót már nem szabad olvasni
  const watchedRef = useRef(0);

  // 👁️ megtekintés rögzítése az AKTÍV posztra (eredeti VAGY remix) — poszttonként egyszer.
  // A poszt ELHAGYÁSAKOR (cleanup) a végignézést is rögzítjük (watched/duration) a
  // For-You ranking valós jeleihez (viewSignals). A `player.currentTime` a néző-pozíció
  // (weben a videó-elemé); best-effort — csak hitelesített nézőre megy be (RLS).
  useEffect(() => {
    if (!activeId) {
      return;
    }
    if (!viewedRef.current.has(activeId)) {
      viewedRef.current.add(activeId);
      recordView(activeId);
    }
    const leavingId = activeId;
    return () => {
      const post = findPost(leavingId);
      const durSec = post?.durationSec ?? 0;
      // ⚠️ A cleanup a poszt ELHAGYÁSAKOR fut — ekkorra az expo-video player már felszabadulhatott
      // (unmount/fast-refresh), és egy released shared object bármely property-je dob. Ezért az
      // utolsó kiolvasott pozícióból dolgozunk; a haladás-figyelő frissíti 200 ms-enként.
      const watchedSec = watchedRef.current;
      watchedRef.current = 0;
      if (durSec > 0 && watchedSec > 0) {
        void recordViewEvent(leavingId, watchedSec * 1000, durSec * 1000);
      }
    };
  }, [activeId, findPost]);

  // az aktív poszt videójának lejátszása (ha van renderelt URL).
  // ⚠️ Csak FÓKUSZBAN: a feedből `push`-sal megyünk a szerkesztőbe/csatornára/
  // lejátszóba, tehát a feed mountolva marad — kapu nélkül a videó a háttérben
  // tovább szólna a megnyitott képernyő alatt.
  useEffect(() => {
    const uri = activeUri;
    // 🌐 web: a lejátszást a natív <video autoPlay> intézi (az expo-video web-play
    // nem indít). Itt csak a FÓKUSZ-váltásra reagálunk: elhagyva a feedet szünet,
    // visszatérve folytatás (a feed mountolva marad más képernyő alatt).
    if (Platform.OS === 'web') {
      const v = activeVideoElRef.current;
      if (v) {
        if (!uri || !isFocused) {
          v.pause();
        } else {
          v.muted = mutedRef.current;
          void v.play().catch((caught) => { logCaught('hooks/useFeed.ts:useFeed', caught); });
        }
      }
      return;
    }
    if (!uri || !isFocused) {
      player.pause();
      return;
    }
    // iOS-en a `replace` SZINKRON tölti az asszetet a fő szálon (UI-fagyás) →
    // `replaceAsync`. A `cancelled` őr: ha közben vált az aktív poszt / elveszik a
    // fókusz, a késve beérő betöltés NE indítson lejátszást a rossz videón.
    let cancelled = false;
    // az ELŐZŐ videó AZONNAL álljon le (hang is) — ne szóljon az async betöltés alatt
    player.pause();
    player
      .replaceAsync(uri)
      .then(() => {
        if (!cancelled) {
          player.muted = mutedRef.current; // a replace ne nullázza a némítást
          player.volume = volumeRef.current;
          player.play();
        }
      })
      .catch((caught) => { logCaught('hooks/useFeed.ts:useFeed', caught); });
    return () => {
      cancelled = true;
    };
  }, [activeUri, player, isFocused, activeVideoElRef, mutedRef, volumeRef]);

  // hotspot-időzítés: az aktív poszt lejátszási idejét figyeljük (ha van hotspot)
  useEffect(() => {
    if (!activePost || hotspotsOf(activePost).length === 0) {
      return;
    }
    const iv = setInterval(() => {
      // web: a tényleges lejátszó a <video> elem; natív: az expo-video player.
      // (Korábban weben is a player.currentTime-t olvasta → mindig 0 → a hotspotok
      // SOHA nem jelentek meg weben.)
      const tt =
        Platform.OS === 'web'
          ? activeVideoElRef.current?.currentTime ?? 0
          : player.currentTime ?? 0;
      setHotspotTime(tt);
    }, 250);
    return () => clearInterval(iv);
  }, [activePost, player, activeVideoElRef, setHotspotTime]);

  // ▶️ az aktív videó haladásának követése az alsó tekerő-csíkhoz (web + natív).
  // A leolvasás az intervallumban fut (nem az effekt-törzsben — cascading render
  // elkerülése); tekerés közben (seekingRef) NEM írjuk felül a vizuális állapotot.
  useEffect(() => {
    const iv = setInterval(() => {
      if (seekingRef.current) {
        return;
      }
      if (!activePost?.videoUri || !isFocused) {
        setProgress(0);
        setClock((c) => (c.cur === 0 && c.dur === 0 ? c : { cur: 0, dur: 0 }));
        return;
      }
      let cur = 0;
      let dur = 0;
      if (Platform.OS === 'web') {
        const v = activeVideoElRef.current;
        cur = v?.currentTime ?? 0;
        dur = v && Number.isFinite(v.duration) ? v.duration : 0;
      } else {
        cur = player.currentTime ?? 0;
        dur = player.duration ?? 0;
      }
      watchedRef.current = cur;
      setProgress(dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0);
      const c2 = { cur: Math.floor(cur), dur: Math.round(dur) };
      setClock((c) => (c.cur === c2.cur && c.dur === c2.dur ? c : c2));
    }, 200);
    return () => clearInterval(iv);
  }, [activePost, isFocused, player, activeVideoElRef, seekingRef, setClock, setProgress]);

  // 🔀 az aktív TOP-poszt remixeinek betöltése (lazy) — a JOBBRA lapozható, full-screen
  // remix-oldalakhoz. Csak látható (`ok`) remixeket tartunk meg; egyszer tölt / poszt.
  useEffect(() => {
    if (!activeTopId) {
      return;
    }
    const top = posts.find((p) => p.id === activeTopId);
    if (!top || top.counts.remixes <= 0 || remixMap[activeTopId]) {
      return;
    }
    let alive = true;
    listRemixesOf(activeTopId)
      .then((rx) => {
        if (alive) {
          setRemixMap((m) => ({ ...m, [activeTopId]: visibleRemixes(rx) }));
        }
      })
      .catch((caught) => { logCaught('hooks/useFeed.ts:useFeed', caught); });
    return () => {
      alive = false;
    };
  }, [activeTopId, posts, remixMap, setRemixMap]);

  return { onViewable };
}
