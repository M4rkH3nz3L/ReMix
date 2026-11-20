import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';

import { zoomIndexForPinch } from '@/lib/audioTimelineGestures';
import { DEFAULT_ZOOM_INDEX, fitPxPerSec, followScrollX, nearestZoomIndex, zoomIn, zoomOut, ZOOM_LEVELS } from '@/lib/audioTransport';

/**
 * 🔍 Az idővonal nézet-állapota: lépcsős / „illeszd” nagyítás, a látható ablak, a görgetés és a
 * lejátszás alatti követés. A lejátszófej a rAF-mesterórából (`playhead`) jön — saját óra nincs.
 */
export function useTimelineView({ playhead, isPlaying }: { playhead: number; isPlaying: boolean }) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  // 📏 A42: a vonalzó és a rács csak a látható ablakra (± egy képernyő) rajzolódik
  const [view, setView] = useState({ x: 0, w: 0 });
  const viewXRef = useRef(0);
  // 🔍 pinch-zoom: a mindig friss zoom-index + a csippentés kezdő-indexe (ref, hogy a
  // gesztus-callback ne stale state-et lásson)
  const zoomIndexRef = useRef(DEFAULT_ZOOM_INDEX);
  zoomIndexRef.current = zoomIndex;
  const pinchStartRef = useRef(DEFAULT_ZOOM_INDEX);

  // 🔍 „illeszd” nagyítás: folytonos px/mp (null = a lépcsős nagyítás él)
  const [fitPps, setFitPps] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);
  // a követéshez a friss méretek (a hook a korai return előtt fut, ezért ref-ből olvas)
  const followRef = useRef({ pps: 56, viewW: 0, contentW: 0 });
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const { pps, viewW, contentW } = followRef.current;
    const x = followScrollX(playhead * pps, scrollXRef.current, viewW, contentW);
    if (x !== null) {
      scrollRef.current?.scrollTo({ x, animated: false });
    }
  }, [playhead, isPlaying]);

  return { zoomIndex, setZoomIndex, view, setView, viewXRef, zoomIndexRef, pinchStartRef, fitPps, setFitPps, scrollRef, scrollXRef, followRef };
}

/** a `useTimelineView` állapota — a nagyítás-műveletek és az idővonal-terület bemenete */
export type TimelineView = ReturnType<typeof useTimelineView>;

/**
 * 🔍 a nagyítás műveletei (csippentés, ± lépés, „illeszd”) — a render-időbeli `view`/`fitPps`/`zoomIndex`
 * értékekből, ahogy a törzs renderje adja
 */
export function timelineZoomActions({
  fitPps,
  zoomIndex,
  view,
  duration,
  setFitPps,
  setZoomIndex,
  scrollRef,
  pinchStartRef,
  zoomIndexRef,
}: {
  fitPps: number | null;
  zoomIndex: number;
  view: { x: number; w: number };
  duration: number;
  setFitPps: Dispatch<SetStateAction<number | null>>;
  setZoomIndex: Dispatch<SetStateAction<number>>;
  scrollRef: RefObject<ScrollView | null>;
  pinchStartRef: RefObject<number>;
  zoomIndexRef: RefObject<number>;
}) {
  // 🔍 kétujjas csippentés = idővonal-zoom (a 7 szint közt lépked). A pinch a
  // timelineWrap-en ül → a 2-ujjas zoom és az 1-ujjas vízszintes görgetés nem ütközik.
  const timelinePinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      // az „illeszd” állapotból a legközelebbi lépcsőről indul a csippentés
      pinchStartRef.current = fitPps !== null ? nearestZoomIndex(fitPps) : zoomIndexRef.current;
    })
    .onUpdate((e) => {
      const next = zoomIndexForPinch(pinchStartRef.current, e.scale, ZOOM_LEVELS.length);
      if (next !== zoomIndexRef.current || fitPps !== null) {
        setFitPps(null);
        setZoomIndex(next);
      }
    });

  const zoomStep = (dir: 1 | -1) => {
    const from = fitPps !== null ? nearestZoomIndex(fitPps) : zoomIndex;
    setFitPps(null);
    setZoomIndex(dir > 0 ? zoomIn(from) : zoomOut(from));
  };
  const fitToView = () => {
    setFitPps(fitPxPerSec(view.w || 1200, duration));
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  };
  return { timelinePinch, zoomStep, fitToView };
}

/** a vízszintes görgető mérete és görgetése → a látható ablak (`view`) és a követés görgetés-refje */
export function timelineScrollHandlers({
  setView,
  scrollXRef,
  viewXRef,
  viewW,
}: {
  setView: Dispatch<SetStateAction<{ x: number; w: number }>>;
  scrollXRef: RefObject<number>;
  viewXRef: RefObject<number>;
  viewW: number;
}) {
  return {
    onLayout: (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      setView((v) => (v.w === w ? v : { ...v, w }));
    },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // csak negyed-képernyőnyi elmozdulásnál rajzol újra (nem minden képkockánál)
      const x = e.nativeEvent.contentOffset.x;
      scrollXRef.current = x;
      if (Math.abs(x - viewXRef.current) > viewW / 4) {
        viewXRef.current = x;
        setView((v) => ({ ...v, x }));
      }
    },
  };
}
