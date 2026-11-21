import { router } from 'expo-router';
import type { VideoPlayer } from 'expo-video';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Alert, Linking, Platform, type FlatList } from 'react-native';

import { isValidActionUrl } from '@/lib/url';
import { pageFromScroll } from '@/lib/feedPager';
import type { FeedPost } from '@/types/social';
import type { InteractiveClip } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎮 Lejátszás- és lapozás-vezérlők (REFACTOR: a useFeed-ből) — hook-mentes csoport, minden
 * renderben újra létrehozva: hotspot-akció, alkotó megnyitása, koppintás (play/pause),
 * vízszintes remix-lapozás.
 */
export function createFeedControls({
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
}: {
  player: VideoPlayer;
  activeVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  activeId: string | null;
  activeTopId: string | null;
  pageIndex: Record<string, number>;
  setPageIndex: Dispatch<SetStateAction<Record<string, number>>>;
  setVolumeOpen: Dispatch<SetStateAction<boolean>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setHotspotTime: Dispatch<SetStateAction<number>>;
  seekingRef: MutableRefObject<boolean>;
  listRefs: MutableRefObject<Map<string, FlatList<FeedPost>>>;
  flashPlayPause: (nowPlaying: boolean) => void;
  contentW: number;
}) {
  const handleHotspot = (clip: InteractiveClip) => {
    const a = clip.action;
    if (a.type === 'url') {
      // más felhasználó adata: csak http(s) nyitható meg
      if (!isValidActionUrl(a.url)) {
        logCaught('hooks/useFeed.ts:handleHotspot', new Error('Érvénytelen hotspot-cím'));
        return;
      }
      Linking.openURL(a.url).catch((caught) => { logCaught('hooks/useFeed.ts:handleHotspot', caught); });
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
            void v.play().catch((caught) => { logCaught('hooks/useFeed.ts:onTapItem', caught); });
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

  return { handleHotspot, openCreator, onTapItem, onPagerScroll, goToPage };
}
