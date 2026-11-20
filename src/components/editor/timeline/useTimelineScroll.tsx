import { useEffect, useRef, useState, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { ScrollView } from 'react-native-gesture-handler';

import { countClips, OVERSCAN_FACTOR, VIRTUALIZE_MIN_CLIPS } from '@/lib/timelineLayout';
import { windowFor } from '@/lib/virtualize';
import type { EditorState } from '@/store/editorState';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🎞️ Scroll ↔ lejátszófej szinkron: a középre rögzített fej alatt a tartalom
 * görgetése scrubol, lejátszáskor pedig a scroll imperatívan követi a playheadet
 * (a master-óra a store `playhead`-jét írja). A Timeline-ból kiemelve.
 */
export function useTimelineScroll({
  lastScrollX,
  pps,
  isPlaying,
  setPlayhead,
  setPlaying,
}: {
  /** az utolsó ismert scroll-pozíció (px) — a Timeline-é, mert a render is olvassa */
  lastScrollX: RefObject<number>;
  pps: number;
  isPlaying: boolean;
  setPlayhead: EditorState['setPlayhead'];
  setPlaying: EditorState['setPlaying'];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrubbing = useRef(false);
  const scrubEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 🖱️ web: az idővonal-konténer DOM-node-ja (egér fogd-és-húzd + wheel a sávterületen)
  const [viewportW, setViewportW] = useState(0);
  // 🪟 a virtualizációs ablak (px, a belső view lokális koordinátájában) — chunkolt
  const [clipWindow, setClipWindow] = useState<{ start: number; end: number } | null>(null);
  const winCenterRef = useRef(0);

  /**
   * ⚡ A scroll IMPERATÍVAN követi a lejátszófejet — a Timeline NEM iratkozik fel
   * a `playhead`-re.
   *
   * A playhead lejátszás közben ~60×/mp változik, de ebben a komponensben az
   * EGYETLEN felhasználása ez a `scrollTo` volt. Feliratkozva minden tick
   * újraépítette a teljes fát (vonalzó-osztások, beat-pontok — egy 3 perces,
   * 120 BPM-es zenénél ~450 View —, régiók, jelölők, vágás-javaslatok, keresési
   * találatok). A store-feliratkozás React-render NÉLKÜL fut le.
   */
  const ppsRef = useRef(pps);
  // a frissítés effektben, nem a render törzsében: a render-közbeni ref-írás
  // React-anti-minta, és a fordító emiatt is kihagyná a komponenst. A zoom
  // váltása amúgy is ritka, és a lenti `[pps]` effekt újra is pozicionál.
  useEffect(() => {
    ppsRef.current = pps;
  }, [pps]);
  // 🧹 a scrub-vég időzítő lebontáskor is törlődjön: a web-pointer effekt cleanupja
  // csak a listenereket szedi le, a natív scrub-ág pedig gesztus-handlerben indítja —
  // így egyik útvonal sem takarítaná unmountkor a még függő időzítőt.
  useEffect(
    () => () => {
      if (scrubEndTimer.current) {
        clearTimeout(scrubEndTimer.current);
        scrubEndTimer.current = null;
      }
    },
    []
  );
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (s.playhead === prev.playhead || scrubbing.current) {
          return;
        }
        const target = s.playhead * ppsRef.current;
        if (Math.abs(target - lastScrollX.current) > 2) {
          scrollRef.current?.scrollTo({ x: target, animated: false });
        }
      }),
    // a `lastScrollX` a Timeline stabil ref-objektuma: a dep nem indítja újra az effektet
    [lastScrollX]
  );

  // zoom-váltáskor (pps változik) egyszer újra pozicionálunk — ez ritka esemény
  useEffect(() => {
    if (scrubbing.current) {
      return;
    }
    const target = useEditorStore.getState().playhead * pps;
    if (Math.abs(target - lastScrollX.current) > 2) {
      scrollRef.current?.scrollTo({ x: target, animated: false });
    }
  }, [pps, lastScrollX]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    lastScrollX.current = x;
    if (scrubbing.current && !isPlaying) {
      // 🎞️ a scrub a frame-rácsra ül (fél-kocka csúszás már látszik — §2.6 parity)
      setPlayhead(x / pps, true);
    }
    // 🪟 virtualizációs ablak: CHUNKOLT frissítés (csak fél viewportnyi elmozdulás
    // után) és CSAK sok klipnél — így a rövid projekt „nulla re-render" viselkedése
    // (a lejátszófej-scroll React-render nélkül fut) érintetlen marad.
    if (viewportW > 0 && Math.abs(x - winCenterRef.current) >= viewportW * 0.5) {
      const proj = useEditorStore.getState().project;
      const count = countClips(proj);
      if (count > VIRTUALIZE_MIN_CLIPS) {
        winCenterRef.current = x;
        setClipWindow(windowFor(x, viewportW, OVERSCAN_FACTOR));
      }
    }
  };

  const onScrollBeginDrag = () => {
    scrubbing.current = true;
    if (scrubEndTimer.current) {
      clearTimeout(scrubEndTimer.current);
    }
    if (useEditorStore.getState().isPlaying) {
      setPlaying(false);
    }
  };
  const onScrollEndDrag = () => {
    // ha nem indul momentum, rövid idő után visszaadjuk az auto-követést
    scrubEndTimer.current = setTimeout(() => {
      scrubbing.current = false;
    }, 120);
  };
  const onMomentumScrollBegin = () => {
    if (scrubEndTimer.current) {
      clearTimeout(scrubEndTimer.current);
    }
    scrubbing.current = true;
  };
  const onMomentumScrollEnd = () => {
    scrubbing.current = false;
  };

  return {
    scrollRef,
    viewportW,
    setViewportW,
    clipWindow,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  };
}
