import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, FlatList, Linking, Platform, useWindowDimensions, type ViewToken } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { showError } from '@/components/ui/errorAlert';
import { haptics } from '@/design';
import {
  getChannel,
  listFeed,
  listRemixesOf,
  recordView,
  recordViewEvent,
  remixFromPost,
  toggleFollow,
  toggleLike,
  toggleSave,
} from '@/lib/feed';
import { pageFromScroll, remixPages, resolveActiveId, visibleRemixes } from '@/lib/feedPager';
import { runOptimistic } from '@/lib/optimistic';
import { REPORT_REASONS, reportPost } from '@/lib/reports';
import { blockUser, filterBlocked, listMyBlockedIds } from '@/lib/blocks';
import type { FeedMode, FeedPost } from '@/types/social';
import { moderatePostGlobal } from '@/lib/roles';
import { useRoles } from '@/store/roleStore';
import type { InteractiveClip } from '@/types/project';

/** Egy poszt interaktív (hotspot) klipjei a poszton hordozott interaktív rétegből. */
export function hotspotsOf(post: FeedPost): InteractiveClip[] {
  const track = post.interactive?.tracks?.find((tr) => tr.type === 'interactive');
  return (track?.clips ?? []).filter((c): c is InteractiveClip => c.kind === 'interactive');
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * 🧠 A FEED (home) képernyő NEM-prezentációs logikája (Health/02.4): adat-betöltés,
 * blokk-szűrés, lazy remix-lapozás, a videó-lejátszó/haladás/hotspot-időzítés, a
 * némítás/hangerő + tekerés gesztusok, és az összes interakciós handler (like/mentés/
 * remix/moderáció/jelentés/követés). A képernyő JSX-e CSAK az itt visszaadott
 * állapotból + handlerekből olvas — a háló/command-bus hívások VÁLTOZATLANOK.
 *
 * SZÁNDÉKOSAN EGY hookban marad a lejátszó + a gesztusok + a refek: ezek szorosan
 * csatoltak (közös élő-state ref-eken át, animációk, rAF-szerű intervallumok). A
 * szétvágásuk viselkedés-driftet kockáztatna, ezért EGYBEN maradnak.
 */
export function useFeed() {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // az akció-sor és a felirat az alsó menü FÖLÖTT üljön — a menü valós magassága
  // BOTTOM_NAV_HEIGHT + a képernyő-alji biztonságos zóna (home indicator), nem csak 56
  const chromeBottom = BOTTOM_NAV_HEIGHT + insets.bottom + 24;
  // ▶️ a tekerő-csík az alsó menü FÖLÖTT, közvetlenül a képernyő alján
  const seekBottom = BOTTOM_NAV_HEIGHT + insets.bottom + 6;
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
  const [hotspotTime, setHotspotTime] = useState(0);
  // ▶️ videó-haladás (0–1) az alsó tekerő-csíkhoz + tekerés-állapot/szélesség
  const [progress, setProgress] = useState(0);
  const seekingRef = useRef(false);
  const seekWidthRef = useRef(1);
  // TikTok-szerű: minden vezérlő (rail + felirat + menü) MINDIG látszik — nincs
  // automatikus elrejtés, és a scroll/koppintás sem rejti el.
  const chromeVisible = true;

  // egyetlen lejátszó, ami az AKTÍV poszt videójára vált (renderelt MP4 URL)
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    // 🌐 weben a HANGOS autoplay tiltott → némán indítunk (különben a videó „el sem
    // indul"); a hangot a rail némítás-gombja kapcsolja be (kattintás = user gesztus).
    if (Platform.OS === 'web') {
      p.muted = true;
    }
  });
  // némítás-állapot (weben alapból néma az autoplayhez)
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const mutedRef = useRef(Platform.OS === 'web');
  // 🔊 hangerő (0–1) + a szabályzó-csúszka nyitva van-e + a csúszka magassága
  const [volume, setVolume] = useState(1);
  const volumeRef = useRef(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volHeightRef = useRef(1);
  // a feed `push`-sal nyit más képernyőt → mountolva marad; a videó ne szóljon takarva
  const isFocused = useIsFocused();

  // 🌐 web: STABIL ref a natív <video>-hoz. FONTOS, hogy `useCallback([])` legyen:
  // az inline ref MINDEN rendernél (pl. a 200 ms-es haladás-tick) újrafutna és
  // meghívná a `play()`-t → a kézzel szüneteltetett videó azonnal újraindulna
  // („kattintásra nem áll le"). Stabil ref → csak MOUNTkor indít, újrarendernél nem.
  // 🌐 web: az AKTÍV poszt <video> eleme. NEM `querySelector('video')` — az a DOM
  // ELSŐ videóját adná (lapozáskor a rossz/elavult elemet vezérelnénk, és az előző
  // hangja átszivárogna). Ez mindig a JELENLEG aktív poszt eleme.
  const activeVideoElRef = useRef<HTMLVideoElement | null>(null);
  const webVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el) {
      // új aktív videó mountol → az ELŐZŐT lezárjuk (hang is), nehogy tovább szóljon
      const prev = activeVideoElRef.current;
      if (prev && prev !== el) {
        try {
          prev.pause();
          prev.currentTime = 0;
        } catch {
          /* a leváló elem már eldobható */
        }
      }
      activeVideoElRef.current = el;
      el.muted = mutedRef.current;
      el.volume = volumeRef.current;
      void el.play?.().catch(() => {});
    }
  }, []);

  // 💬 a komment-gomb figyelemfelkeltő pulzálása (új funkció jelzése)
  const commentPulse = useRef(new Animated.Value(0)).current;
  // ❤️ dupla-tap like: középső szív-pop animáció (TikTok-szerű)
  const heartAnim = useRef(new Animated.Value(0)).current;
  // ▶️/⏸️ középső play/pause villanás kattintáskor (melyik ikon + animáció)
  const ppAnim = useRef(new Animated.Value(0)).current;
  const [ppIcon, setPpIcon] = useState<'play' | 'pause'>('play');

  // 💬 a komment-gomb háttér-pulzálása (radar-effekt) — hogy a user észrevegye az újdonságot
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(commentPulse, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [commentPulse]);

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
        .catch(() => {
          setPosts([]);
          setActiveTopId(null);
        })
        .finally(() => setLoading(false));
    },
    [channelId, startId]
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
      .catch(() => {
        /* nem bejelentkezve / nincs backend → nincs blokk-szűrés */
      });
  }, []);

  const changeMode = (m: FeedMode) => {
    bumpChrome();
    if (m === mode) {
      return;
    }
    setLoading(true);
    setPosts([]);
    setMode(m);
  };

  // egy poszt frissítése id alapján — a top-listában ÉS a betöltött remixek közt is
  // (a remix-oldalakon is működjön az optimista like/mentés/komment-számláló)
  const patch = (id: string, fn: (p: FeedPost) => FeedPost) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
    setRemixMap((prev) => {
      let changed = false;
      const next: Record<string, FeedPost[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        let listChanged = false;
        const nl = list.map((p) => {
          if (p.id === id) {
            listChanged = true;
            return fn(p);
          }
          return p;
        });
        if (listChanged) {
          changed = true;
        }
        next[k] = listChanged ? nl : list;
      }
      return changed ? next : prev;
    });
  };

  // a chrome mindig látszik (nincs auto-elrejtés) → nincs teendő; a hívások maradnak,
  // hogy a jövőbeli finomítás egy helyen bekötheto legyen
  const bumpChrome = () => {};

  const onLike = (post: FeedPost) => {
    bumpChrome();
    const liked = !post.viewerLiked;
    const apply = (on: boolean) => (p: FeedPost) => ({
      ...p,
      viewerLiked: on,
      counts: { ...p.counts, likes: p.counts.likes + (on ? 1 : -1) },
    });
    // ⚡ §12.4: optimista (azonnali visszajelzés) + VISSZAGÖRGETÉS hibánál a közös
    // helperrel — enélkül az UI a szerverrel ELLENTÉTES állapotot mutatna.
    void runOptimistic({
      apply: () => patch(post.id, apply(liked)),
      rollback: () => patch(post.id, apply(!liked)),
      commit: () => toggleLike(post.id, liked),
    });
  };

  // ❤️ középső szív-pop lejátszása (dupla-tap vizuális visszajelzése)
  const popHeart = () => {
    heartAnim.setValue(0);
    Animated.sequence([
      Animated.spring(heartAnim, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(heartAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // ▶️/⏸️ középső play/pause villanás: `nowPlaying=true` → „play" ikon (elindult),
  // false → „pause" ikon (megállt). Rövid pop + elhalványulás, nem fog érintést.
  const flashPlayPause = (nowPlaying: boolean) => {
    setPpIcon(nowPlaying ? 'play' : 'pause');
    ppAnim.setValue(0);
    Animated.sequence([
      Animated.spring(ppAnim, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(ppAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // dupla-tap a videón → LIKE (csak lájkol, nem vesz vissza) + szív-pop + haptika
  const onDoubleTapLike = (post: FeedPost) => {
    haptics.impact();
    if (!post.viewerLiked) {
      onLike(post);
    } else {
      bumpChrome();
    }
    popHeart();
  };

  // egyszeres tap = play/pause (onTapItem), dupla tap = like — a gesture-handler
  // a dupla-tap elbukásáig vár az egyszeressel, így nincs kézi késleltetés/flicker
  const tapGesture = (post: FeedPost) =>
    Gesture.Exclusive(
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd(() => onDoubleTapLike(post))
        .runOnJS(true),
      Gesture.Tap()
        .maxDuration(260)
        .onEnd(() => onTapItem(post))
        .runOnJS(true)
    );

  const onSave = (post: FeedPost) => {
    bumpChrome();
    const saved = !post.viewerSaved;
    const apply = (on: boolean) => (p: FeedPost) => ({
      ...p,
      viewerSaved: on,
      counts: { ...p.counts, saves: p.counts.saves + (on ? 1 : -1) },
    });
    // optimista + visszagörgetés hibánál (lásd onLike)
    void runOptimistic({
      apply: () => patch(post.id, apply(saved)),
      rollback: () => patch(post.id, apply(!saved)),
      commit: () => toggleSave(post.id, saved),
    });
  };

  const onRemix = (post: FeedPost) => {
    bumpChrome();
    if (busy) {
      return;
    }
    if (!post.remixable || !post.videoUri) {
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
      .catch((e: unknown) => showError(e, 'remix'))
      .finally(() => setBusy(false));
  };

  // ⚠️ A sikert csak a hívás UTÁN jelentjük: korábban az Alert azonnal ment, így
  // hálózati hiba esetén is azt mondtuk, hogy „követed" — pedig nem.
  // 🛡️ globális moderáció: bármely poszt eltávolítása a feedből (post.moderate jog)
  const onModerate = (post: FeedPost) => {
    bumpChrome();
    Alert.alert(t('feed.moderate.title'), t('feed.moderate.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.moderate.remove'),
        style: 'destructive',
        onPress: () =>
          moderatePostGlobal(post.id, 'removed')
            .then(() => {
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
              setRemixMap((prev) => {
                const next: Record<string, FeedPost[]> = {};
                for (const [k, list] of Object.entries(prev)) {
                  next[k] = list.filter((p) => p.id !== post.id);
                }
                return next;
              });
            })
            .catch((e: unknown) => showError(e)),
      },
    ]);
  };

  // 🚩 poszt bejelentése (nem-saját) — ok-választó
  // 🚩 jelentés ok-választó (a moderációs menüből)
  const reportWithReason = (post: FeedPost) => {
    Alert.alert(t('report.title'), t('report.pickReason'), [
      ...REPORT_REASONS.map((r) => ({
        text: t(`report.reason_${r}`),
        onPress: () =>
          reportPost(post.id, r)
            .then(() => Alert.alert(t('report.title'), t('report.done')))
            .catch((e: unknown) => showError(e)),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  // 🛡️ szerző blokkolása: a block szerverre megy, a posztjai AZONNAL eltűnnek a feedből
  const onBlockUser = (post: FeedPost) => {
    const name = post.creator.username ? `@${post.creator.username}` : t('report.thisUser');
    Alert.alert(t('report.blockTitle'), t('report.blockConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' as const },
      {
        text: t('report.blockAction'),
        style: 'destructive' as const,
        onPress: () =>
          blockUser(post.creator.id)
            .then(() => {
              blockedIdsRef.current = [...blockedIdsRef.current, post.creator.id];
              setPosts((prev) => prev.filter((p) => p.creator.id !== post.creator.id));
              Alert.alert(t('report.blockTitle'), t('report.blockDone', { name }));
            })
            .catch((e: unknown) => showError(e)),
      },
    ]);
  };

  // 🚩 moderációs menü (nem-saját poszt): jelentés VAGY a szerző blokkolása
  const onReportPost = (post: FeedPost) => {
    bumpChrome();
    Alert.alert(t('report.title'), undefined, [
      { text: t('report.label'), onPress: () => reportWithReason(post) },
      { text: t('report.blockAction'), style: 'destructive' as const, onPress: () => onBlockUser(post) },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const onFollow = (post: FeedPost) => {
    bumpChrome();
    toggleFollow(post.creator.id, true)
      .then(() =>
        Alert.alert(t('feed.title'), t('feed.followed', { name: post.creator.displayName }))
      )
      .catch(() => Alert.alert(t('common.error'), t('feed.followFailed')));
  };

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
      // ⚠️ A cleanup a poszt ELHAGYÁSAKOR fut — ekkorra az expo-video player már
      // felszabadulhatott (unmount/fast-refresh), és egy released shared object
      // bármely property-je ERR_USING_RELEASED_SHARED_OBJECT-et dob. Best-effort:
      // ha nem olvasható a pozíció, csendben kihagyjuk a végignézés-jel rögzítését.
      let watchedSec = 0;
      try {
        watchedSec =
          Platform.OS === 'web'
            ? activeVideoElRef.current?.currentTime ?? 0
            : player.currentTime ?? 0;
      } catch {
        return;
      }
      if (durSec > 0 && watchedSec > 0) {
        void recordViewEvent(leavingId, watchedSec * 1000, durSec * 1000);
      }
    };
  }, [activeId, findPost, player]);

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
          void v.play().catch(() => {});
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeUri, player, isFocused]);

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
  }, [activePost, player]);

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
      setProgress(dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0);
    }, 200);
    return () => clearInterval(iv);
  }, [activePost, isFocused, player]);

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
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeTopId, posts, remixMap]);

  const handleHotspot = (clip: InteractiveClip) => {
    const a = clip.action;
    if (a.type === 'url') {
      Linking.openURL(a.url).catch(() => {});
    } else if (a.type === 'seek') {
      if (Platform.OS === 'web') {
        const v = activeVideoElRef.current;
        if (v) {
          v.currentTime = a.toTime;
        }
      } else {
        player.currentTime = a.toTime;
      }
    } else if (a.type === 'quiz') {
      Alert.alert(
        a.question,
        undefined,
        a.answers.map((ans, i) => ({
          text: ans,
          onPress: () =>
            Alert.alert(i === a.correctIndex ? '✅' : '❌', ans),
        }))
      );
    }
  };

  const openCreator = (post: FeedPost) => router.push(`/channel/${post.creator.id}`);

  // Egy koppintás: szünet/lejátszás. HÁROM koppintás: a kezelőfelület be/ki.
  // Az egyszeri koppintást késleltetve dolgozzuk fel, hogy a hármast elkaphassuk —
  // így a hármas koppintás nem villogtatja a lejátszást.
  // egy koppintás = szünet/lejátszás + középső play/pause villanás
  // (a dupla-tap like-ot a Gesture.Exclusive kezeli)
  const onTapItem = (post: FeedPost) => {
    setVolumeOpen(false); // a hangerő-csúszkát a videóra koppintás bezárja
    if (post.id === activeId && post.videoUri) {
      if (Platform.OS === 'web') {
        const v = activeVideoElRef.current;
        if (v) {
          if (v.paused) {
            void v.play().catch(() => {});
            flashPlayPause(true);
          } else {
            v.pause();
            flashPlayPause(false);
          }
        }
        return;
      }
      if (player.playing) {
        player.pause();
        flashPlayPause(false);
      } else {
        player.play();
        flashPlayPause(true);
      }
      return;
    }
    if (post.projectId) {
      router.push(`/player/${post.projectId}`);
    }
  };

  const pageHeight = height;
  // 🖥️ weben/széles nézetben a feed egy KÖZÉPRE igazított, 9:16 „telefon"-oszlop —
  // különben a teljes szélességű lap szétvágja a függőleges videót és szétszórja az
  // overlay-eket (desktop-káosz). Mobilon a teljes szélesség marad (contentW = width).
  const isWideWeb = Platform.OS === 'web' && width > 540;
  const contentW = isWideWeb ? Math.min(width, Math.round(pageHeight * (9 / 16))) : width;

  // vízszintes lapozás egy TOP-poszton belül (0 = eredeti, 1..N = remixek). A küszöb
  // csak akkor frissít, ha egy lapra „beállt" (mid-swipe villódzás nélkül, web is).
  const onPagerScroll = (topId: string, offsetX: number) => {
    const idx = pageFromScroll(offsetX, contentW);
    if (idx === null || pageIndex[topId] === idx) {
      return;
    }
    setPageIndex((prev) => ({ ...prev, [topId]: idx }));
    // vízszintes lapváltás (eredeti ↔ remix) az aktív poszton → UI nullázása
    if (topId === activeTopId) {
      setProgress(0);
      setHotspotTime(0);
      seekingRef.current = false;
    }
  };
  // nyíl-gombos / programozott lapozás (a jelző-gombokhoz + a webes vezérléshez)
  const goToPage = (topId: string, idx: number) => {
    listRefs.current.get(topId)?.scrollToOffset({ offset: idx * contentW, animated: true });
    setPageIndex((prev) => ({ ...prev, [topId]: idx }));
    if (topId === activeTopId) {
      setProgress(0);
      setHotspotTime(0);
      seekingRef.current = false;
    }
  };

  // a pulzáló glow-gyűrű stílusa (scale ki + elhalványul, loopban)
  const pulseStyle = {
    transform: [{ scale: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
    opacity: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  };

  // ▶️ tekerés: a csíkon húzva/koppintva a lejátszót a megfelelő időre állítjuk.
  // A gesture STABIL (useMemo) — a tényleges seek egy ref-en át fut, hogy ne
  // kelljen a gesture-t minden progress-tickre újraépíteni.
  const doSeekRef = useRef<(ratio: number) => void>(() => {});
  doSeekRef.current = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio));
    setProgress(r);
    if (Platform.OS === 'web') {
      const v = activeVideoElRef.current;
      if (v && Number.isFinite(v.duration)) {
        v.currentTime = r * v.duration;
      }
    } else {
      const dur = player.duration ?? 0;
      if (dur > 0) {
        player.currentTime = r * dur;
      }
    }
  };
  const seekGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          seekingRef.current = true;
          doSeekRef.current(e.x / seekWidthRef.current);
        })
        .onUpdate((e) => doSeekRef.current(e.x / seekWidthRef.current))
        .onFinalize(() => {
          seekingRef.current = false;
        })
        .runOnJS(true),
    []
  );

  // 🔊 hangerő beállítása (0–1): a videó/lejátszó volume + muted egyben. 0 = néma.
  const doVolumeRef = useRef<(v: number) => void>(() => {});
  doVolumeRef.current = (v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    volumeRef.current = vol;
    setVolume(vol);
    const m = vol === 0;
    mutedRef.current = m;
    setMuted(m);
    if (Platform.OS === 'web') {
      const el = activeVideoElRef.current;
      if (el) {
        el.volume = vol;
        el.muted = m;
        if (!m) {
          void el.play().catch(() => {});
        }
      }
    } else {
      player.volume = vol;
      player.muted = m;
    }
  };
  // a függőleges csúszkán: fent = 1, lent = 0 (e.y a csúszka tetejétől)
  const volumeGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => doVolumeRef.current(1 - e.y / volHeightRef.current))
        .onUpdate((e) => doVolumeRef.current(1 - e.y / volHeightRef.current))
        .runOnJS(true),
    []
  );

  // 🔊 a hang-gomb: némít/hangosít + a hangerő-csúszka megnyitása (hangosításkor)
  const onToggleMute = (sub: FeedPost) => {
    const nm = !mutedRef.current;
    if (!nm && volumeRef.current === 0) {
      volumeRef.current = 1;
      setVolume(1);
    }
    mutedRef.current = nm;
    setMuted(nm);
    setVolumeOpen((o) => (nm ? o : true)); // hangosításkor nyíljon a csúszka
    if (Platform.OS === 'web') {
      const v = activeVideoElRef.current;
      if (v) {
        v.muted = nm;
        v.volume = volumeRef.current;
        if (!nm) {
          void v.play().catch(() => {});
        }
      }
    } else {
      player.muted = nm;
      player.volume = volumeRef.current;
      if (!nm && sub.id === activeId) {
        player.play();
      }
    }
  };

  return {
    // i18n / elrendezés
    t,
    insets,
    chromeBottom,
    seekBottom,
    chromeVisible,
    pageHeight,
    contentW,
    width,
    // mód / channel
    mode,
    changeMode,
    channelId,
    startId,
    channelTitle,
    // adat
    posts,
    loading,
    remixMap,
    listExtra,
    listRefs,
    // aktív poszt / lapozás
    activeId,
    pageIndex,
    onViewable,
    onPagerScroll,
    goToPage,
    // lejátszó / web-video
    player,
    webVideoRef,
    // hang
    muted,
    volume,
    volumeOpen,
    volHeightRef,
    volumeGesture,
    onToggleMute,
    // haladás / tekerés
    progress,
    seekWidthRef,
    seekGesture,
    // hotspot
    hotspotTime,
    handleHotspot,
    // animációk
    heartAnim,
    ppAnim,
    ppIcon,
    pulseStyle,
    // interakciók
    canModeratePost,
    tapGesture,
    onLike,
    onSave,
    onRemix,
    onModerate,
    onReportPost,
    onFollow,
    openCreator,
    // sheet-ek
    commentFor,
    setCommentFor,
    giftFor,
    setGiftFor,
    collectionFor,
    setCollectionFor,
    patch,
    // pager-segéd
    remixPages,
  };
}
