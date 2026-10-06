import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { CollectionSheet } from '@/components/CollectionSheet';
import { CommentSheet } from '@/components/CommentSheet';
import { GiftSheet } from '@/components/GiftSheet';
import { LiveNowStrip } from '@/components/live/LiveNowStrip';
import { showError } from '@/components/ui/errorAlert';
import { haptics } from '@/design';
import { HotspotOverlay } from '@/components/preview/HotspotOverlay';
import { palette } from '@/constants/editor';
import {
  currentUserId,
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
import type { FeedMode, FeedPost } from '@/types/social';
import { moderatePostGlobal } from '@/lib/roles';
import { useRoles } from '@/store/roleStore';
import type { InteractiveClip } from '@/types/project';

/** Egy poszt interaktív (hotspot) klipjei a poszton hordozott interaktív rétegből. */
function hotspotsOf(post: FeedPost): InteractiveClip[] {
  const track = post.interactive?.tracks?.find((tr) => tr.type === 'interactive');
  return (track?.clips ?? []).filter((c): c is InteractiveClip => c.kind === 'interactive');
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function FeedScreen() {
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
        .then((list) => {
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
  const onReportPost = (post: FeedPost) => {
    bumpChrome();
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
      const watchedSec =
        Platform.OS === 'web'
          ? activeVideoElRef.current?.currentTime ?? 0
          : player.currentTime ?? 0;
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
      const t =
        Platform.OS === 'web'
          ? activeVideoElRef.current?.currentTime ?? 0
          : player.currentTime ?? 0;
      setHotspotTime(t);
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

  // egy poszt-OLDAL teljes tartalma (videó + overlay-ek + rail + felirat + seek +
  // hotspotok). Ugyanez renderel egy EREDETI posztot ÉS minden hozzá csatolt REMIXET
  // is (a vízszintes lapozó celláiban) — `sub` az adott oldal posztja, `topPost` a
  // vízszintes lapozót birtokló eredeti poszt (a nyíl-gombos ugráshoz).
  const renderPostBody = (
    sub: FeedPost,
    subIndex: number,
    pageCount: number,
    topPost: FeedPost
  ) => (
    <>
      <GestureDetector gesture={tapGesture(sub)}>
        <View style={StyleSheet.absoluteFill}>
          {sub.id === activeId && sub.videoUri ? (
            Platform.OS === 'web' ? (
              // 🌐 web: NATÍV <video> (az expo-video web-lejátszója nem indít autoplay-t);
              // némítva a böngésző engedi az autoplay-t, a rail gombja kapcsol hangot.
              createElement('video', {
                src: sub.videoUri,
                autoPlay: true,
                muted,
                loop: true,
                playsInline: true,
                controls: false,
                poster: sub.posterUri ?? undefined,
                // a React `muted` attribútuma megbízhatatlan (a böngésző így blokkolhatja
                // az autoplay-t) → STABIL ref-fel a DOM-propertyt állítjuk + indítjuk
                // a lejátszást (nem minden rendernél — különben nem lehetne megállítani)
                ref: webVideoRef,
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#000',
                },
              })
            ) : (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                nativeControls={false}
              />
            )
          ) : sub.posterUri ? (
            <Image source={{ uri: sub.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient colors={['#1a1e2e', '#0c0d12', '#241a3a']} style={StyleSheet.absoluteFill} />
          )}
        </View>
      </GestureDetector>

      {/* ❤️ dupla-tap like — középső szív-pop (csak az aktív oldalon, nem fog érintést) */}
      {sub.id === activeId ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.heartPop,
            {
              opacity: heartAnim,
              transform: [
                { scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] }) },
              ],
            },
          ]}
        >
          <Ionicons name="heart" size={120} color="#ffffff" />
        </Animated.View>
      ) : null}

      {/* ▶️/⏸️ középső play/pause villanás a videóra koppintáskor (nem fog érintést) */}
      {sub.id === activeId ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ppFlash,
            {
              opacity: ppAnim,
              transform: [{ scale: ppAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
            },
          ]}
        >
          <View style={styles.ppFlashCircle}>
            <Ionicons name={ppIcon} size={52} color="#fff" />
          </View>
        </Animated.View>
      ) : null}

      {/* 🔊 függőleges hangerő-csúszka (a hang-gomb nyitja) — húzva állítható, 0 = néma */}
      {volumeOpen && sub.id === activeId ? (
        <GestureDetector gesture={volumeGesture}>
          <View
            style={[styles.volSlider, { bottom: chromeBottom + 40 }]}
            hitSlop={12}
            onLayout={(e) => {
              volHeightRef.current = e.nativeEvent.layout.height || 1;
            }}
          >
            <View style={[styles.volFill, { height: `${Math.round(volume * 100)}%` }]} />
          </View>
        </GestureDetector>
      ) : null}

      {/* jobb oldali akció-sor (like/komment/mentés/remix/…) — a többi chrome-mal
          EGYÜTT rejtőzik/jelenik meg (hármas koppintás / auto-hide): immerzív módban
          csak a videó + a user-hotspotok látszanak. */}
      {chromeVisible ? (
        <View style={[styles.rail, { bottom: chromeBottom }]}>
        <Pressable style={styles.railBtn} onPress={() => openCreator(sub)}>
          <View style={styles.avatar}>
            {sub.creator.avatarUri ? (
              <Image
                source={{ uri: sub.creator.avatarUri }}
                style={styles.avatarImg}
                contentFit="cover"
              />
            ) : (
              <Text style={styles.avatarText}>
                {(sub.creator.displayName || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          <Pressable style={styles.followDot} onPress={() => onFollow(sub)} hitSlop={6}>
            <Ionicons name="add" size={12} color="#fff" />
          </Pressable>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onLike(sub)}>
          <Ionicons
            name={sub.viewerLiked ? 'heart' : 'heart-outline'}
            size={34}
            color={sub.viewerLiked ? palette.danger : '#fff'}
          />
          <Text style={styles.railCount}>{compact(sub.counts.likes)}</Text>
        </Pressable>
        {/* 🔊 hang: koppintás = némít/hangosít ÉS megnyitja a hangerő-csúszkát */}
        <Pressable
          style={styles.railBtn}
          onPress={() => {
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
          }}
        >
          <Ionicons
            name={muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'}
            size={30}
            color="#fff"
          />
        </Pressable>
        <Pressable
          style={styles.railBtn}
          onPress={() => {
            bumpChrome();
            setCommentFor(sub);
          }}
        >
          <View style={styles.commentIconWrap}>
            <Animated.View style={[styles.commentRing, pulseStyle]} pointerEvents="none" />
            <Ionicons name="chatbubbles" size={34} color={palette.accent} />
            <View style={styles.railNew} pointerEvents="none">
              <Text style={styles.railNewText}>{t('feed.newBadge')}</Text>
            </View>
          </View>
          <Text style={styles.railCount}>{compact(sub.counts.comments)}</Text>
        </Pressable>
        <Pressable
          style={styles.railBtn}
          onPress={() => onSave(sub)}
          onLongPress={() => setCollectionFor(sub)}
          delayLongPress={300}
        >
          <Ionicons
            name={sub.viewerSaved ? 'bookmark' : 'bookmark-outline'}
            size={30}
            color={sub.viewerSaved ? palette.accent2 : '#fff'}
          />
          <Text style={styles.railCount}>{compact(sub.counts.saves)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onRemix(sub)}>
          <Ionicons name="shuffle" size={32} color={palette.accent} />
          <Text style={styles.railCount}>{compact(sub.counts.remixes)}</Text>
        </Pressable>
        {currentUserId() !== sub.creator.id ? (
          <Pressable style={styles.railBtn} onPress={() => setGiftFor(sub)}>
            <Ionicons name="gift" size={30} color={palette.accent2} />
            <Text style={styles.railCount}>{t('wallet.gift.title')}</Text>
          </Pressable>
        ) : null}
        {canModeratePost ? (
          <Pressable style={styles.railBtn} onPress={() => onModerate(sub)}>
            <Ionicons name="shield-outline" size={30} color={palette.danger} />
            <Text style={styles.railCount}>{t('feed.moderate.label')}</Text>
          </Pressable>
        ) : null}
        {currentUserId() !== sub.creator.id ? (
          <Pressable style={styles.railBtn} onPress={() => onReportPost(sub)}>
            <Ionicons name="flag-outline" size={28} color="#fff" />
            <Text style={styles.railCount}>{t('report.label')}</Text>
          </Pressable>
        ) : null}
        </View>
      ) : null}

      {/* 🔀 REMIX-JELZŐ az EREDETIN (0. lap): jobb szélen egy kis nyíl + darabszám —
          „van remix, húzd jobbról balra". Koppintva is átvisz (web-vezérlő is). */}
      {chromeVisible && pageCount > 1 && subIndex === 0 ? (
        <Pressable
          style={styles.remixSwipe}
          onPress={() => goToPage(topPost.id, 1)}
          accessibilityRole="button"
          accessibilityLabel={t('feed.remixSwipeHint')}
        >
          <Ionicons name="shuffle" size={16} color="#fff" />
          <Text style={styles.remixSwipeCount}>{pageCount - 1}</Text>
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Pressable>
      ) : null}

      {/* ◀️ VISSZA az eredetihez a remix-oldalakon: bal szélen nyíl (web-vezérlő is) */}
      {chromeVisible && subIndex > 0 ? (
        <Pressable
          style={styles.remixBack}
          onPress={() => goToPage(topPost.id, subIndex - 1)}
          accessibilityRole="button"
          accessibilityLabel={t('feed.backToOriginal')}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
      ) : null}

      {/* 🔵 lap-pöttyök (eredeti + remixek) — felül középen, a mód-váltó alatt */}
      {chromeVisible && pageCount > 1 ? (
        <View style={[styles.dots, { top: insets.top + 44 }]} pointerEvents="none">
          {Array.from({ length: pageCount }).map((_, i) => (
            <View key={i} style={[styles.dot, i === subIndex && styles.dotActive]} />
          ))}
        </View>
      ) : null}

      {/* alul-bal: alkotó + felirat — a többi chrome-mal együtt (hármas koppintás / auto-hide) */}
      {chromeVisible ? (
        <View style={[styles.caption, { bottom: chromeBottom }]}>
          {sub.promoted ? (
            <View style={styles.sponsored}>
              <Ionicons name="megaphone" size={11} color="#fff" />
              <Text style={styles.sponsoredText}>{t('feed.sponsored')}</Text>
            </View>
          ) : null}
          <Pressable onPress={() => openCreator(sub)}>
            <Text style={styles.creator}>@{sub.creator.username}</Text>
          </Pressable>
          <Text style={styles.captionText} numberOfLines={2}>
            {sub.title}
          </Text>
          {sub.hashtags.length > 0 ? (
            <Text style={styles.tags} numberOfLines={1}>
              {sub.hashtags.map((h, i) => (
                <Text key={h} onPress={() => router.push(`/hashtag/${encodeURIComponent(h)}`)}>
                  {i > 0 ? ' ' : ''}#{h}
                </Text>
              ))}
            </Text>
          ) : null}
          {sub.remixOfCreator ? (
            <Text style={styles.remixOf}>🔀 {t('feed.remixOf', { name: sub.remixOfCreator })}</Text>
          ) : null}
        </View>
      ) : null}

      {/* ▶️ alsó tekerő-csík: hol jár a videó + húzva/koppintva tekerés */}
      {sub.id === activeId && sub.videoUri ? (
        <GestureDetector gesture={seekGesture}>
          <View
            style={[styles.seekBar, { bottom: seekBottom }]}
            hitSlop={{ top: 14, bottom: 14 }}
            onLayout={(e) => {
              seekWidthRef.current = e.nativeEvent.layout.width || 1;
            }}
          >
            <View style={styles.seekTrack} />
            <View style={[styles.seekFill, { width: `${Math.round(progress * 100)}%` }]} />
            <View style={[styles.seekThumb, { left: `${Math.round(progress * 100)}%` }]} />
          </View>
        </GestureDetector>
      ) : null}

      {/* interaktív hotspotok (az aktív, épp látható időablakban) — MINDIG legfelül,
          hogy a hirdetés-hotspotokat a kezelőfelület soha ne takarja el */}
      {sub.id === activeId
        ? hotspotsOf(sub)
            .filter((c) => hotspotTime >= c.start && hotspotTime < c.start + c.duration)
            .map((c) => (
              <HotspotOverlay
                key={c.id}
                clip={c}
                t={hotspotTime - c.start}
                box={{ w: contentW, h: pageHeight }}
                mode="play"
                selected={false}
                onPress={handleHotspot}
              />
            ))
        : null}
    </>
  );

  // egy TOP-poszt = egy függőleges oldal, amin belül VÍZSZINTESEN lapozható az eredeti
  // + a csatolt remixek (full-screen). Jobbról-balra húzva jön elő a remix; a videó a
  // beállt laphoz vált. (A lista MINDIG jelen van — remixek nélkül 1 lap, scroll tiltva.)
  const renderItem = ({ item }: { item: FeedPost }) => {
    const pages = remixPages(item, remixMap[item.id]);
    return (
      <View style={[styles.page, { height: pageHeight, width }]}>
        {/* 🖥️ középre igazított 9:16 oszlop (weben) — az overlay-ek EHHEZ igazodnak */}
        <View style={[styles.column, { width: contentW, height: pageHeight }]}>
          <FlatList
            ref={(r: FlatList<FeedPost> | null) => {
              if (r) {
                listRefs.current.set(item.id, r);
              } else {
                listRefs.current.delete(item.id);
              }
            }}
            horizontal
            pagingEnabled
            scrollEnabled={pages.length > 1}
            directionalLockEnabled
            nestedScrollEnabled
            data={pages}
            extraData={activeId ?? ''}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={32}
            getItemLayout={(_, index) => ({ length: contentW, offset: contentW * index, index })}
            onScroll={(e) => onPagerScroll(item.id, e.nativeEvent.contentOffset.x)}
            onMomentumScrollEnd={(e) => onPagerScroll(item.id, e.nativeEvent.contentOffset.x)}
            renderItem={({ item: sub, index }) => (
              <View style={{ width: contentW, height: pageHeight }}>
                {renderPostBody(sub, index, pages.length, item)}
              </View>
            )}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* felső mód-váltó — csak a kezelőfelülettel együtt (hármas koppintás) */}
      {chromeVisible ? (
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          {channelId ? (
            <View style={styles.channelBar}>
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
              <Text style={styles.channelTitle} numberOfLines={1}>
                @{channelTitle}
              </Text>
              <View style={{ width: 26 }} />
            </View>
          ) : (
            <>
            {/* 🖥️ a felső sort a KÖZÉPRE igazított videó-oszlophoz kötjük (contentW) —
                különben weben (isWideWeb) az ikonok a böngésző két távoli szélére
                kerülnének (a rail/felirat is az oszlophoz igazodik). */}
            <View style={[styles.topRow, { width: contentW }]}>
              {/* 🔴 bal: ÉLŐ — a mód-váltóval egy vonalban (külön route) */}
              <Pressable
                style={styles.topIconBtn}
                onPress={() => router.push('/live')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('feed.live')}
              >
                <Ionicons name="radio-outline" size={24} color="#fff" />
                <View style={styles.liveDot} pointerEvents="none" />
              </Pressable>

              <View style={styles.modeRow}>
                <Pressable onPress={() => changeMode('following')}>
                  <Text style={[styles.modeText, mode === 'following' && styles.modeActive]}>
                    {t('feed.following')}
                  </Text>
                </Pressable>
                <Text style={styles.modeSep}>|</Text>
                <Pressable onPress={() => changeMode('foryou')}>
                  <Text style={[styles.modeText, mode === 'foryou' && styles.modeActive]}>
                    {t('feed.forYou')}
                  </Text>
                </Pressable>
                <Text style={styles.modeSep}>|</Text>
                <Pressable onPress={() => changeMode('trending')}>
                  <Text style={[styles.modeText, mode === 'trending' && styles.modeActive]}>
                    {t('feed.trending')}
                  </Text>
                </Pressable>
              </View>

              {/* 🔎 jobb: KERESŐ — a mód-váltóval egy vonalban (külön route) */}
              <Pressable
                style={styles.topIconBtn}
                onPress={() => router.push('/search')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('feed.search')}
              >
                <Ionicons name="search" size={24} color="#fff" />
              </Pressable>
            </View>
            {/* 🔴 LIVE now — a követett hostok élő adásai (üresen nem renderel) */}
            <View style={{ width: contentW }}>
              <LiveNowStrip />
            </View>
            </>
          )}
        </SafeAreaView>
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="videocam-outline" size={48} color={palette.border} />
          <Text style={styles.emptyText}>
            {mode === 'following' ? t('feed.emptyFollowing') : t('feed.empty')}
          </Text>
          <Pressable style={styles.emptyCta} onPress={() => router.push('/studio')}>
            <Text style={styles.emptyCtaText}>{t('feed.createCta')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={listExtra}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={pageHeight}
          decelerationRate="fast"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          initialScrollIndex={
            channelId && startId ? Math.max(0, posts.findIndex((p) => p.id === startId)) : undefined
          }
          onScrollToIndexFailed={() => {}}
        />
      )}

      {/* alsó menü — csak hármas koppintás után (immerzív alap); channel-módban vissza-gomb visz */}
      {chromeVisible && !channelId ? <BottomNav active="feed" /> : null}

      {/* 🎁 ajándék-lap (a poszt szerzőjének, TikTok-modell) */}
      <GiftSheet
        visible={giftFor !== null}
        toUsername={giftFor?.creator.username ?? ''}
        toName={giftFor?.creator.displayName}
        postId={giftFor?.id ?? null}
        onClose={() => setGiftFor(null)}
      />

      {/* 📁 kollekció-választó (a mentés-gomb hosszú-nyomására) */}
      <CollectionSheet postId={collectionFor?.id ?? null} onClose={() => setCollectionFor(null)} />

      {/* 💬 komment-lap (a komment-gomb nyitja) */}
      <CommentSheet
        post={commentFor}
        onClose={() => setCommentFor(null)}
        onCountChange={(d) => {
          if (commentFor) {
            patch(commentFor.id, (p) => ({
              ...p,
              counts: { ...p.counts, comments: Math.max(0, p.counts.comments + d) },
            }));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, alignItems: 'center' },
  // felső sor: [ÉLŐ] — [Követett | Neked] — [Kereső]; a szélső ikon-gombok azonos
  // szélessége tartja KÖZÉPEN a mód-váltót (space-between + egyenlő oldalak)
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  topIconBtn: { width: 40, height: 32, alignItems: 'center', justifyContent: 'center' },
  liveDot: {
    position: 'absolute',
    top: 3,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.danger,
    borderWidth: 1,
    borderColor: '#000',
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  channelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  channelTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '800' },
  modeText: { color: '#ffffffaa', fontSize: 16, fontWeight: '700' },
  modeActive: { color: '#fff', textDecorationLine: 'underline' },
  modeSep: { color: '#ffffff66' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyText: { color: palette.textDim, fontSize: 15, textAlign: 'center' },
  emptyCta: {
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 6,
  },
  emptyCtaText: { color: '#fff', fontWeight: '800' },
  page: { justifyContent: 'flex-end', alignItems: 'center', backgroundColor: '#000' },
  // a középre igazított 9:16 videó-oszlop (weben szűkebb, mobilon teljes szélesség)
  column: { alignSelf: 'center', overflow: 'hidden', backgroundColor: '#000' },
  heartPop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 18 },
  railBtn: { alignItems: 'center', gap: 3 },
  railCount: { color: '#fff', fontSize: 12, fontWeight: '700' },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  followDot: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: palette.danger,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { position: 'absolute', left: 14, right: 84, gap: 5 },
  creator: { color: '#fff', fontSize: 16, fontWeight: '800' },
  captionText: { color: '#fff', fontSize: 14 },
  sponsored: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#00000066',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sponsoredText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  tags: { color: '#cbb8ff', fontSize: 13, fontWeight: '600' },
  remixOf: { color: '#ffffffcc', fontSize: 12, fontWeight: '600' },
  // 🔀 remix-lapozó jelzések: jobb szélen a „van remix, húzd" nyíl az eredetin,
  // bal szélen a „vissza" nyíl a remix-oldalakon, felül a lap-pöttyök.
  remixSwipe: {
    position: 'absolute',
    right: 0,
    top: '44%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#00000066',
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 8,
  },
  remixSwipeCount: { color: '#fff', fontSize: 13, fontWeight: '800' },
  remixBack: {
    position: 'absolute',
    left: 0,
    top: '44%',
    backgroundColor: '#00000066',
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 8,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff66' },
  dotActive: { width: 18, backgroundColor: '#fff' },
  // ▶️ alsó tekerő-csík (haladás + seek)
  seekBar: { position: 'absolute', left: 12, right: 12, height: 16, justifyContent: 'center' },
  seekTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#ffffff40',
  },
  seekFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  seekThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    top: 2,
    backgroundColor: '#fff',
  },
  // ▶️/⏸️ középső play/pause villanás
  ppFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ppFlashCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 🔊 függőleges hangerő-csúszka
  volSlider: {
    position: 'absolute',
    right: 56,
    width: 30,
    height: 140,
    borderRadius: 15,
    backgroundColor: '#00000088',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  volFill: { width: '100%', backgroundColor: '#ffffffdd' },
  tapHint: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00000088',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 30,
  },
  tapHintText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  commentIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  commentRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.accent,
  },
  railNew: {
    position: 'absolute',
    top: -6,
    right: -12,
    backgroundColor: palette.danger,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  railNewText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.3 },
});
