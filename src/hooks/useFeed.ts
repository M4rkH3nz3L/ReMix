import { useTranslation } from 'react-i18next';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { remixPages } from '@/lib/feedPager';
import { createFeedActions } from '@/hooks/feed/createFeedActions';
import { createFeedControls } from '@/hooks/feed/createFeedControls';
import { useActivePostEffects } from '@/hooks/feed/useActivePostEffects';
import { useFeedAnimations } from '@/hooks/feed/useFeedAnimations';
import { useFeedLoader } from '@/hooks/feed/useFeedLoader';
import { useFeedPlaybackState } from '@/hooks/feed/useFeedPlaybackState';
import { useFeedSeekVolume } from '@/hooks/feed/useFeedSeekVolume';
import { useFeedSelection } from '@/hooks/feed/useFeedSelection';
import { useFeedTapGesture } from '@/hooks/feed/useFeedTapGesture';

export { compact, hotspotsOf } from '@/hooks/feed/feedFormat';

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
 *
 * REFACTOR: a részek a `hooks/feed/` alatt élnek, de a hook-hívások SORRENDJE, az effektek
 * sorrendje és a közös refek változatlanok — a fenti csatolás így egyben marad.
 */
export function useFeed() {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // az akció-sor és a felirat az alsó menü FÖLÖTT üljön — a menü valós magassága
  // BOTTOM_NAV_HEIGHT + a képernyő-alji biztonságos zóna (home indicator), nem csak 56
  // (a lejátszási sor — hangerő-gomb · tekerő-csík · óra — 32 pt magas, ez fölött)
  const chromeBottom = BOTTOM_NAV_HEIGHT + insets.bottom + 34;
  // ▶️ a lejátszási sor alja: az alsó menü FÖLÖTT, közvetlenül a képernyő alján
  const seekBottom = BOTTOM_NAV_HEIGHT + insets.bottom - 2;
  const {
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
  } = useFeedSelection();
  const {
    hotspotTime,
    setHotspotTime,
    progress,
    setProgress,
    clock,
    setClock,
    seekingRef,
    seekWidthRef,
    player,
    muted,
    setMuted,
    mutedRef,
    volume,
    setVolume,
    volumeRef,
    volumeOpen,
    setVolumeOpen,
    volWidthRef,
    isFocused,
    activeVideoElRef,
    webVideoRef,
  } = useFeedPlaybackState();
  // TikTok-szerű: minden vezérlő (rail + felirat + menü) MINDIG látszik — nincs
  // automatikus elrejtés, és a scroll/koppintás sem rejti el.
  const chromeVisible = true;
  const { heartAnim, ppAnim, ppIcon, popHeart, flashPlayPause, pulseStyle } = useFeedAnimations();

  useFeedLoader({ mode, channelId, startId, setChannelTitle, setPosts, setActiveTopId, setLoading, blockedIdsRef });

  const { changeMode, patch, onLike, onDoubleTapLike, onSave, onRemix, onModerate, onReportPost, onFollow } =
    createFeedActions({ t, mode, busy, setLoading, setPosts, setMode, setRemixMap, setBusy, blockedIdsRef, popHeart });

  const { tapGesture, onTapItemRef, onDoubleTapRef } = useFeedTapGesture();

  const { onViewable } = useActivePostEffects({
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
  });

  const pageHeight = height;
  // 🖥️ weben/széles nézetben a feed egy KÖZÉPRE igazított, 9:16 „telefon"-oszlop —
  // különben a teljes szélességű lap szétvágja a függőleges videót és szétszórja az
  // overlay-eket (desktop-káosz). Mobilon a teljes szélesség marad (contentW = width).
  const isWideWeb = Platform.OS === 'web' && width > 540;
  const contentW = isWideWeb ? Math.min(width, Math.round(pageHeight * (9 / 16))) : width;

  const { handleHotspot, openCreator, onTapItem, onPagerScroll, goToPage } = createFeedControls({
    player,
    activeVideoElRef,
    activeId,
    activeTopId,
    pageIndex,
    setPageIndex,
    setVolumeOpen,
    setProgress,
    setHotspotTime,
    seekingRef,
    listRefs,
    flashPlayPause,
    contentW,
  });
  onTapItemRef.current = onTapItem;
  onDoubleTapRef.current = onDoubleTapLike;

  const { seekGesture, volumeGesture, nudgeVolume, onVolumeButton, onToggleMute } = useFeedSeekVolume({
    player,
    activeVideoElRef,
    activeId,
    setProgress,
    setClock,
    seekingRef,
    seekWidthRef,
    mutedRef,
    setMuted,
    volumeRef,
    setVolume,
    setVolumeOpen,
    volWidthRef,
  });

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
    volWidthRef,
    volumeGesture,
    nudgeVolume,
    onVolumeButton,
    onToggleMute,
    // haladás / tekerés
    progress,
    clock,
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
