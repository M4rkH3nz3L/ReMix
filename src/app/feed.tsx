import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
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
import { CommentSheet } from '@/components/CommentSheet';
import { showError } from '@/components/ui/errorAlert';
import { haptics } from '@/design';
import { HotspotOverlay } from '@/components/preview/HotspotOverlay';
import { palette } from '@/constants/editor';
import {
  currentUserId,
  listFeed,
  listRemixesOf,
  recordView,
  remixFromPost,
  toggleFollow,
  toggleLike,
  toggleSave,
} from '@/lib/feed';
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

/** a poszthoz csatolt remix-sáv egy kártyájának szélessége (snap-lapozáshoz) */
const REMIX_CARD_W = 116;

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
  const [mode, setMode] = useState<FeedMode>('foryou');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [commentFor, setCommentFor] = useState<FeedPost | null>(null);
  // 🛡️ globális poszt-moderátor jog → „eltávolítás a feedből" gomb bármely poszton
  const canModeratePost = useRoles((s) => s.permissions.includes('post.moderate'));
  const [activeId, setActiveId] = useState<string | null>(null);
  // 🔀 az egyes posztokhoz CSATOLT remixek (lazy — csak az aktív poszté töltődik),
  // a poszt alján balról-jobbra lapozható remix-sávhoz
  const [remixMap, setRemixMap] = useState<Record<string, FeedPost[]>>({});
  const [hotspotTime, setHotspotTime] = useState(0);
  // A jobb oldali akció-sor (like/komment/mentés/remix) MINDIG látszik. A többi
  // chrome (mód-váltó, felirat, alsó menü) alapból látszik, de hármas koppintás
  // elrejti (immerzív, tiszta videó), és pár mp tétlenség után is elhalványul.
  // A hirdetés-hotspotok mindig látszanak, azt sosem takarjuk el.
  const [chromeVisible, setChromeVisible] = useState(true);
  // minden interakció bumpolja → az auto-elrejtés 4 mp-es órája újraindul
  const [chromeNonce, setChromeNonce] = useState(0);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // a feed `push`-sal nyit más képernyőt → mountolva marad; a videó ne szóljon takarva
  const isFocused = useIsFocused();

  // felfedezhetőség: rövid, nem tolakodó tipp a hármas koppintásról, majd elhalványul
  const [hintMounted, setHintMounted] = useState(true);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  // 💬 a komment-gomb figyelemfelkeltő pulzálása (új funkció jelzése)
  const commentPulse = useRef(new Animated.Value(0)).current;
  // ❤️ dupla-tap like: középső szív-pop animáció (TikTok-szerű)
  const heartAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(hintOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(hintOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        setHintMounted(false);
      }
    });
  }, [hintOpacity]);

  // 💬 a komment-gomb háttér-pulzálása (radar-effekt) — hogy a user észrevegye az újdonságot
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(commentPulse, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [commentPulse]);

  // koppintás-időzítő eltakarítása kilépéskor
  useEffect(
    () => () => {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
      }
    },
    []
  );

  // auto-elrejtés: ha a kezelőfelület látszik, de 4 mp-ig nincs interakció, tűnjön el.
  // A `chromeNonce` minden interakciónál változik → az óra újraindul.
  useEffect(() => {
    if (!chromeVisible) {
      return;
    }
    const to = setTimeout(() => setChromeVisible(false), 4000);
    return () => clearTimeout(to);
  }, [chromeVisible, chromeNonce]);

  const load = useCallback((m: FeedMode) => {
    listFeed(m)
      .then((list) => {
        setPosts(list);
        // ⚡ az első elem AZONNAL aktív legyen — különben a lista „rajtra marad":
        // az első videó a viewability-eseményig nem indul be. Érvényes meglévő
        // aktívat megtartunk (frissítés/patch után ne ugorjon vissza az elejére).
        setActiveId((prev) => (prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)));
      })
      .catch(() => {
        setPosts([]);
        setActiveId(null);
      })
      .finally(() => setLoading(false));
  }, []);

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

  const patch = (id: string, fn: (p: FeedPost) => FeedPost) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));

  // interakció a kezelőfelülettel → az auto-elrejtés órájának újraindítása
  const bumpChrome = () => setChromeNonce((n) => n + 1);

  const onLike = (post: FeedPost) => {
    bumpChrome();
    const liked = !post.viewerLiked;
    const apply = (on: boolean) => (p: FeedPost) => ({
      ...p,
      viewerLiked: on,
      counts: { ...p.counts, likes: p.counts.likes + (on ? 1 : -1) },
    });
    patch(post.id, apply(liked)); // optimista: azonnali visszajelzés
    // ⚠️ VISSZAGÖRGETÉS hibánál: enélkül az UI a szerverrel ELLENTÉTES állapotot
    // mutatott a következő frissítésig (a felhasználó azt hitte, lájkolt)
    toggleLike(post.id, liked).catch(() => patch(post.id, apply(!liked)));
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
    patch(post.id, apply(saved));
    // visszagörgetés hibánál (lásd onLike)
    toggleSave(post.id, saved).catch(() => patch(post.id, apply(!saved)));
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
            .then(() => setPosts((prev) => prev.filter((p) => p.id !== post.id)))
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
  const onViewable = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems[0]?.item as FeedPost | undefined;
    if (first) {
      setActiveId(first.id);
      if (!viewedRef.current.has(first.id)) {
        viewedRef.current.add(first.id);
        recordView(first.id);
      }
    }
  }).current;

  // az aktív poszt videójának lejátszása (ha van renderelt URL).
  // ⚠️ Csak FÓKUSZBAN: a feedből `push`-sal megyünk a szerkesztőbe/csatornára/
  // lejátszóba, tehát a feed mountolva marad — kapu nélkül a videó a háttérben
  // tovább szólna a megnyitott képernyő alatt.
  useEffect(() => {
    const active = posts.find((p) => p.id === activeId);
    const uri = active?.videoUri ?? null;
    // 🌐 web: a lejátszást a natív <video autoPlay> intézi (az expo-video web-play
    // nem indít). Itt csak a FÓKUSZ-váltásra reagálunk: elhagyva a feedet szünet,
    // visszatérve folytatás (a feed mountolva marad más képernyő alatt).
    if (Platform.OS === 'web') {
      const v = document.querySelector('video');
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
    player
      .replaceAsync(uri)
      .then(() => {
        if (!cancelled) {
          player.muted = mutedRef.current; // a replace ne nullázza a némítást
          player.play();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeId, posts, player, isFocused]);

  // hotspot-időzítés: az aktív poszt lejátszási idejét figyeljük (ha van hotspot)
  useEffect(() => {
    const active = posts.find((p) => p.id === activeId);
    if (!active || hotspotsOf(active).length === 0) {
      return;
    }
    const iv = setInterval(() => setHotspotTime(player.currentTime ?? 0), 250);
    return () => clearInterval(iv);
  }, [activeId, posts, player]);

  // 🔀 az aktív poszt remixeinek betöltése (lazy) — a poszthoz CSATOLT, balról-jobbra
  // lapozható remix-sávhoz. Csak akkor kér le, ha van remix és még nincs betöltve.
  useEffect(() => {
    const active = posts.find((p) => p.id === activeId);
    if (!active || active.counts.remixes <= 0 || remixMap[active.id]) {
      return;
    }
    let alive = true;
    listRemixesOf(active.id)
      .then((rx) => {
        if (alive) {
          setRemixMap((m) => ({ ...m, [active.id]: rx }));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeId, posts, remixMap]);

  const handleHotspot = (clip: InteractiveClip) => {
    const a = clip.action;
    if (a.type === 'url') {
      Linking.openURL(a.url).catch(() => {});
    } else if (a.type === 'seek') {
      player.currentTime = a.toTime;
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
  const onTapItem = (post: FeedPost) => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setHintMounted(false);
      setChromeVisible((v) => !v);
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      const taps = tapCountRef.current;
      tapCountRef.current = 0;
      tapTimerRef.current = null;
      if (taps >= 2) {
        return; // a dupla koppintást szándékosan nem használjuk
      }
      if (post.id === activeId && post.videoUri) {
        // renderelt videó: koppintásra szünet/lejátszás
        if (player.playing) {
          player.pause();
        } else {
          player.play();
        }
      } else if (post.projectId) {
        router.push(`/player/${post.projectId}`);
      }
    }, 260);
  };

  const pageHeight = height;
  // 🖥️ weben/széles nézetben a feed egy KÖZÉPRE igazított, 9:16 „telefon"-oszlop —
  // különben a teljes szélességű lap szétvágja a függőleges videót és szétszórja az
  // overlay-eket (desktop-káosz). Mobilon a teljes szélesség marad (contentW = width).
  const isWideWeb = Platform.OS === 'web' && width > 540;
  const contentW = isWideWeb ? Math.min(width, Math.round(pageHeight * (9 / 16))) : width;

  // a pulzáló glow-gyűrű stílusa (scale ki + elhalványul, loopban)
  const pulseStyle = {
    transform: [{ scale: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
    opacity: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  };

  const renderItem = ({ item }: { item: FeedPost }) => (
    <View style={[styles.page, { height: pageHeight, width }]}>
      {/* 🖥️ középre igazított 9:16 oszlop (weben) — az overlay-ek EHHEZ igazodnak */}
      <View style={[styles.column, { width: contentW, height: pageHeight }]}>
      <GestureDetector gesture={tapGesture(item)}>
        <View style={StyleSheet.absoluteFill}>
          {item.id === activeId && item.videoUri ? (
            Platform.OS === 'web' ? (
              // 🌐 web: NATÍV <video> (az expo-video web-lejátszója nem indít autoplay-t);
              // némítva a böngésző engedi az autoplay-t, a rail gombja kapcsol hangot.
              createElement('video', {
                src: item.videoUri,
                autoPlay: true,
                muted,
                loop: true,
                playsInline: true,
                controls: false,
                poster: item.posterUri ?? undefined,
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
          ) : item.posterUri ? (
            <Image source={{ uri: item.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient colors={['#1a1e2e', '#0c0d12', '#241a3a']} style={StyleSheet.absoluteFill} />
          )}
        </View>
      </GestureDetector>

      {/* ❤️ dupla-tap like — középső szív-pop (csak az aktív oldalon, nem fog érintést) */}
      {item.id === activeId ? (
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

      {/* jobb oldali akció-sor (like/komment/mentés/remix/…) — a többi chrome-mal
          EGYÜTT rejtőzik/jelenik meg (hármas koppintás / auto-hide): immerzív módban
          csak a videó + a user-hotspotok látszanak. */}
      {chromeVisible ? (
        <View style={[styles.rail, { bottom: chromeBottom }]}>
        <Pressable style={styles.railBtn} onPress={() => openCreator(item)}>
          <View style={styles.avatar}>
            {item.creator.avatarUri ? (
              <Image
                source={{ uri: item.creator.avatarUri }}
                style={styles.avatarImg}
                contentFit="cover"
              />
            ) : (
              <Text style={styles.avatarText}>
                {(item.creator.displayName || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          <Pressable style={styles.followDot} onPress={() => onFollow(item)} hitSlop={6}>
            <Ionicons name="add" size={12} color="#fff" />
          </Pressable>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onLike(item)}>
          <Ionicons
            name={item.viewerLiked ? 'heart' : 'heart-outline'}
            size={34}
            color={item.viewerLiked ? palette.danger : '#fff'}
          />
          <Text style={styles.railCount}>{compact(item.counts.likes)}</Text>
        </Pressable>
        {/* 🔊 némítás — weben a videó némán autoplayez; ez kapcsolja be a hangot */}
        <Pressable
          style={styles.railBtn}
          onPress={() => {
            const nm = !mutedRef.current;
            mutedRef.current = nm;
            setMuted(nm);
            player.muted = nm;
            if (Platform.OS === 'web') {
              // web: közvetlenül a <video>-n (az expo-video play/muted nem propagál megbízhatóan)
              const v = document.querySelector('video');
              if (v) {
                v.muted = nm;
                if (!nm) {
                  void v.play().catch(() => {});
                }
              }
            } else if (!nm && item.id === activeId) {
              player.play();
            }
          }}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={30} color="#fff" />
        </Pressable>
        <Pressable
          style={styles.railBtn}
          onPress={() => {
            bumpChrome();
            setCommentFor(item);
          }}
        >
          <View style={styles.commentIconWrap}>
            <Animated.View style={[styles.commentRing, pulseStyle]} pointerEvents="none" />
            <Ionicons name="chatbubbles" size={34} color={palette.accent} />
            <View style={styles.railNew} pointerEvents="none">
              <Text style={styles.railNewText}>{t('feed.newBadge')}</Text>
            </View>
          </View>
          <Text style={styles.railCount}>{compact(item.counts.comments)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onSave(item)}>
          <Ionicons
            name={item.viewerSaved ? 'bookmark' : 'bookmark-outline'}
            size={30}
            color={item.viewerSaved ? palette.accent2 : '#fff'}
          />
          <Text style={styles.railCount}>{compact(item.counts.saves)}</Text>
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => onRemix(item)}>
          <Ionicons name="shuffle" size={32} color={palette.accent} />
          <Text style={styles.railCount}>{compact(item.counts.remixes)}</Text>
        </Pressable>
        {canModeratePost ? (
          <Pressable style={styles.railBtn} onPress={() => onModerate(item)}>
            <Ionicons name="shield-outline" size={30} color={palette.danger} />
            <Text style={styles.railCount}>{t('feed.moderate.label')}</Text>
          </Pressable>
        ) : null}
        {currentUserId() !== item.creator.id ? (
          <Pressable style={styles.railBtn} onPress={() => onReportPost(item)}>
            <Ionicons name="flag-outline" size={28} color="#fff" />
            <Text style={styles.railCount}>{t('report.label')}</Text>
          </Pressable>
        ) : null}
        </View>
      ) : null}

      {/* 🔀 a poszthoz CSATOLT remixek — balról-jobbra lapozható sáv a felirat fölött.
          Csak az aktív poszton (a remixek lustán töltődnek) és chrome-mal együtt. */}
      {chromeVisible && (remixMap[item.id]?.length ?? 0) > 0 ? (
        <View style={[styles.remixStrip, { bottom: chromeBottom + 84 }]}>
          <Text style={styles.remixStripLabel}>
            🔀 {t('feed.remixesLabel', { n: remixMap[item.id].length })}
          </Text>
          <FlatList
            horizontal
            data={remixMap[item.id]}
            keyExtractor={(r) => r.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={REMIX_CARD_W + 10}
            decelerationRate="fast"
            contentContainerStyle={styles.remixRow}
            renderItem={({ item: rx }) => (
              <Pressable style={styles.remixCard} onPress={() => openCreator(rx)}>
                {rx.posterUri ? (
                  <Image source={{ uri: rx.posterUri }} style={styles.remixThumb} contentFit="cover" />
                ) : (
                  <LinearGradient colors={['#241a3a', '#0c0d12']} style={styles.remixThumb} />
                )}
                <View style={styles.remixMeta}>
                  <Text style={styles.remixCreator} numberOfLines={1}>
                    @{rx.creator.username}
                  </Text>
                  <View style={styles.remixCounts}>
                    <Ionicons name="heart" size={11} color="#fff" />
                    <Text style={styles.remixCountText}>{compact(rx.counts.likes)}</Text>
                    <Ionicons name="shuffle" size={11} color="#fff" style={styles.remixCountIcon} />
                    <Text style={styles.remixCountText}>{compact(rx.counts.remixes)}</Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {/* alul-bal: alkotó + felirat — a többi chrome-mal együtt (hármas koppintás / auto-hide) */}
      {chromeVisible ? (
        <View style={[styles.caption, { bottom: chromeBottom }]}>
          {item.promoted ? (
            <View style={styles.sponsored}>
              <Ionicons name="megaphone" size={11} color="#fff" />
              <Text style={styles.sponsoredText}>{t('feed.sponsored')}</Text>
            </View>
          ) : null}
          <Pressable onPress={() => openCreator(item)}>
            <Text style={styles.creator}>@{item.creator.username}</Text>
          </Pressable>
          <Text style={styles.captionText} numberOfLines={2}>
            {item.title}
          </Text>
          {item.hashtags.length > 0 ? (
            <Text style={styles.tags} numberOfLines={1}>
              {item.hashtags.map((h) => `#${h}`).join(' ')}
            </Text>
          ) : null}
          {item.remixOfCreator ? (
            <Text style={styles.remixOf}>🔀 {t('feed.remixOf', { name: item.remixOfCreator })}</Text>
          ) : null}
        </View>
      ) : null}

      {/* interaktív hotspotok (az aktív, épp látható időablakban) — MINDIG legfelül,
          hogy a hirdetés-hotspotokat a kezelőfelület soha ne takarja el */}
      {item.id === activeId
        ? hotspotsOf(item)
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
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* felső mód-váltó — csak a kezelőfelülettel együtt (hármas koppintás) */}
      {chromeVisible ? (
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
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
          </View>
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
          <Pressable style={styles.emptyCta} onPress={() => router.push('/')}>
            <Text style={styles.emptyCtaText}>{t('feed.createCta')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={`${activeId ?? ''}:${chromeVisible ? 1 : 0}`}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={pageHeight}
          decelerationRate="fast"
          onScrollBeginDrag={() => setChromeVisible(false)}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
        />
      )}

      {/* rövid, nem tolakodó tipp a hármas koppintásról (indulás után elhalványul) */}
      {hintMounted && !chromeVisible ? (
        <Animated.View style={[styles.tapHint, { opacity: hintOpacity }]} pointerEvents="none">
          <Ionicons name="hand-left-outline" size={14} color="#fff" />
          <Text style={styles.tapHintText}>{t('feed.tapHint')}</Text>
        </Animated.View>
      ) : null}

      {/* alsó menü — csak hármas koppintás után (immerzív alap) */}
      {chromeVisible ? <BottomNav active="feed" /> : null}

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
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6 },
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
  // 🔀 a poszthoz csatolt remix-lapozó sáv (balról-jobbra)
  remixStrip: { position: 'absolute', left: 12, right: 84 },
  remixStripLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  remixRow: { gap: 10, paddingRight: 12 },
  remixCard: {
    width: REMIX_CARD_W,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#00000066',
  },
  remixThumb: { width: REMIX_CARD_W, height: REMIX_CARD_W * 1.3, backgroundColor: '#1a1e2e' },
  remixMeta: { paddingHorizontal: 6, paddingVertical: 5, gap: 3 },
  remixCreator: { color: '#fff', fontSize: 11, fontWeight: '700' },
  remixCounts: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  remixCountText: { color: '#ffffffcc', fontSize: 10, fontWeight: '600' },
  remixCountIcon: { marginLeft: 6 },
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
