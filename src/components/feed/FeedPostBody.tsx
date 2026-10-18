import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { VideoView, type VideoPlayer } from 'expo-video';
import { createElement } from 'react';
import type { TFunction } from 'i18next';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { FeedImageCarousel } from '@/components/feed/FeedImageCarousel';
import { HotspotOverlay } from '@/components/preview/HotspotOverlay';
import { palette } from '@/constants/editor';
import { currentUserId } from '@/lib/feed';
import type { FeedPost } from '@/types/social';
import type { InteractiveClip } from '@/types/project';

import { compact, hotspotsOf } from '@/hooks/useFeed';
import { styles } from './feedStyles';

/**
 * 🎬 EGY poszt-OLDAL teljes tartalma (Health/02.4 prezentációs al-komponens): videó/kép
 * + a középső like/play-pause villanások + a jobb oldali akció-sor (rail) + felirat +
 * alsó tekerő-csík + remix-lapozó-jelzések + interaktív hotspotok. Ugyanez renderel egy
 * EREDETI posztot ÉS minden hozzá csatolt REMIXET is (a vízszintes lapozó celláiban):
 * `sub` az adott oldal posztja, `topPost` a vízszintes lapozót birtokló eredeti poszt.
 *
 * SAJÁT FETCH/STATE NINCS: minden adat, handler, gesztus, animáció és ref a `useFeed`
 * hookból érkezik propként — a render-sorrend és az elrendezés BIT-re azonos a korábbi
 * `renderPostBody`-val. A lejátszó + a gesztusok + a refek SZÁNDÉKOSAN a hookban élnek
 * (szorosan csatolt élő-state), ez a komponens csak megjeleníti őket.
 */
export function FeedPostBody({
  sub,
  subIndex,
  pageCount,
  topPost,
  // állapot / elrendezés
  t,
  activeId,
  chromeVisible,
  chromeBottom,
  seekBottom,
  contentW,
  pageHeight,
  insets,
  canModeratePost,
  // hang
  muted,
  volume,
  volumeOpen,
  volHeightRef,
  volumeGesture,
  onToggleMute,
  // haladás / tekerés / hotspot
  progress,
  seekWidthRef,
  seekGesture,
  hotspotTime,
  handleHotspot,
  // lejátszó / web-video
  player,
  webVideoRef,
  // animációk
  heartAnim,
  ppAnim,
  ppIcon,
  pulseStyle,
  // gesztusok / handlerek
  tapGesture,
  openCreator,
  onLike,
  onSave,
  onRemix,
  onFollow,
  onModerate,
  onReportPost,
  goToPage,
  setCommentFor,
  setCollectionFor,
  setGiftFor,
}: {
  sub: FeedPost;
  subIndex: number;
  pageCount: number;
  topPost: FeedPost;
  t: TFunction;
  activeId: string | null;
  chromeVisible: boolean;
  chromeBottom: number;
  seekBottom: number;
  contentW: number;
  pageHeight: number;
  insets: EdgeInsets;
  canModeratePost: boolean;
  muted: boolean;
  volume: number;
  volumeOpen: boolean;
  volHeightRef: React.MutableRefObject<number>;
  volumeGesture: ComposedGesture | GestureType;
  onToggleMute: (sub: FeedPost) => void;
  progress: number;
  seekWidthRef: React.MutableRefObject<number>;
  seekGesture: ComposedGesture | GestureType;
  hotspotTime: number;
  handleHotspot: (clip: InteractiveClip) => void;
  player: VideoPlayer;
  webVideoRef: (el: HTMLVideoElement | null) => void;
  heartAnim: Animated.Value;
  ppAnim: Animated.Value;
  ppIcon: 'play' | 'pause';
  pulseStyle: StyleProp<ViewStyle>;
  tapGesture: (post: FeedPost) => ComposedGesture | GestureType;
  openCreator: (post: FeedPost) => void;
  onLike: (post: FeedPost) => void;
  onSave: (post: FeedPost) => void;
  onRemix: (post: FeedPost) => void;
  onFollow: (post: FeedPost) => void;
  onModerate: (post: FeedPost) => void;
  onReportPost: (post: FeedPost) => void;
  goToPage: (topId: string, idx: number) => void;
  setCommentFor: (post: FeedPost | null) => void;
  setCollectionFor: (post: FeedPost | null) => void;
  setGiftFor: (post: FeedPost | null) => void;
}) {
  return (
    <>
      <GestureDetector gesture={tapGesture(sub)}>
        <View style={StyleSheet.absoluteFill}>
          {sub.images && sub.images.length > 0 ? (
            // 🖐️ lapozható kép-poszt (kép-projekt carousel-megosztása)
            <FeedImageCarousel images={sub.images} />
          ) : sub.id === activeId && sub.videoUri ? (
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
          <Pressable style={styles.railBtn} onPress={() => onToggleMute(sub)}>
            <Ionicons
              name={muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'}
              size={30}
              color="#fff"
            />
          </Pressable>
          <Pressable style={styles.railBtn} onPress={() => setCommentFor(sub)}>
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
}
