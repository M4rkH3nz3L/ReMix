import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import type { FeedPost } from '@/types/social';

/** 👆 Posztonként STABIL tap-gesztus (REFACTOR: a useFeed-ből, a hook-sorrend változatlan). */
export function useFeedTapGesture() {
  'use no memo'; // a tapGesture identitása renderenként új marad, mint a bontás előtt — a memoizálás külön döntés
  // egyszeres tap = play/pause (onTapItem), dupla tap = like — a gesture-handler
  // a dupla-tap elbukásáig vár az egyszeressel, így nincs kézi késleltetés/flicker.
  // A gesztus posztonként STABIL (gyorsítótár): a feed 200 ms-onként újrarajzol (tekerő-
  // csík, óra), és egy minden rendernél ÚJ gesztus-objektum a GestureDetectort újrakötné
  // — az egyszeres tap a dupla-tap elbukására várva elveszne (iOS: nem vált a play/pause).
  // A handlerek ref-en át a legfrissebb posztot és logikát kapják.
  const tapCacheRef = useRef(new Map<string, ReturnType<typeof Gesture.Exclusive>>());
  const tapPostRef = useRef(new Map<string, FeedPost>());
  const onTapItemRef = useRef<(post: FeedPost) => void>(() => {});
  const onDoubleTapRef = useRef<(post: FeedPost) => void>(() => {});
  const tapGesture = (post: FeedPost) => {
    tapPostRef.current.set(post.id, post);
    const cached = tapCacheRef.current.get(post.id);
    if (cached) {
      return cached;
    }
    const latest = () => tapPostRef.current.get(post.id) ?? post;
    const g = Gesture.Exclusive(
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd(() => onDoubleTapRef.current(latest()))
        .runOnJS(true),
      Gesture.Tap()
        .maxDuration(260)
        .onEnd(() => onTapItemRef.current(latest()))
        .runOnJS(true)
    );
    tapCacheRef.current.set(post.id, g);
    return g;
  };

  return { tapGesture, onTapItemRef, onDoubleTapRef };
}
