import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { rulerTicks } from '@/lib/rulers';
import type { ImageGuide } from '@/types/project';

const RULER = 18; // a vonalzó-sáv vastagsága (px)
const EDGE = 0.012; // a szélre húzva a segédvonal törlődik (normalizált)

/**
 * 📐 Vonalzók + kézzel húzott SEGÉDVONALAK overlay. A felső/bal vonalzó-sávra
 * koppintva új (függőleges/vízszintes) segédvonal; a segédvonalak húzással
 * mozgathatók, a szélre húzva törlődnek. Szerkesztő-only (a render nem égeti be);
 * a réteg-mozgatás a `snapPointToGuides`-szal illeszkedik rájuk (ImageCanvas).
 *
 * Gesztus: modern react-native-gesture-handler (Touch/03). A vonalzó-sáv `Gesture.Tap`
 * (a korábbi „kis elmozdulás = tap" kézi logika helyett), a segédvonal `Gesture.Pan`;
 * mindkettő EGYSZER jön létre (stabil), a friss propokat `dataRef`-ből olvassa,
 * `runOnJS(true)`. A `Tap` `e.x/e.y`-a a sáv lokális koordinátája (= `locationX/Y`).
 */
export function RulersOverlay({
  box,
  guides,
  onAddGuide,
  onMoveGuide,
  onCommitGuide,
}: {
  box: { w: number; h: number };
  guides: ImageGuide[];
  onAddGuide: (axis: 'x' | 'y', pos: number) => void;
  onMoveGuide: (id: string, pos: number) => void;
  onCommitGuide: (id: string, pos: number | null) => void;
}) {
  const dataRef = useRef({ box, onAddGuide });
  dataRef.current = { box, onAddGuide };

  const gestures = useRef<{ top: ReturnType<typeof Gesture.Tap>; left: ReturnType<typeof Gesture.Tap> } | null>(null);
  if (!gestures.current) {
    const makeAdd = (axis: 'x' | 'y') =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
          const d = dataRef.current;
          d.onAddGuide(axis, axis === 'x' ? e.x / d.box.w : e.y / d.box.h);
        });
    gestures.current = { top: makeAdd('x'), left: makeAdd('y') };
  }

  const xTicks = rulerTicks(0, 1, box.w);
  const yTicks = rulerTicks(0, 1, box.h);

  return (
    <>
      {/* segédvonalak (a vonalzók ALATT, hogy a vonalzó-tap ne ütközzön) */}
      {guides.map((g) => (
        <GuideLine key={g.id} guide={g} box={box} onMove={onMoveGuide} onCommit={onCommitGuide} />
      ))}

      {/* felső vonalzó */}
      <GestureDetector gesture={gestures.current.top}>
        <View style={[styles.rulerTop, { width: box.w }]}>
          {xTicks.map((t, i) => (
            <View key={i} pointerEvents="none" style={[styles.tickV, { left: t.px, height: t.major ? 10 : 5 }]} />
          ))}
        </View>
      </GestureDetector>
      {/* bal vonalzó */}
      <GestureDetector gesture={gestures.current.left}>
        <View style={[styles.rulerLeft, { height: box.h }]}>
          {yTicks.map((t, i) => (
            <View key={i} pointerEvents="none" style={[styles.tickH, { top: t.px, width: t.major ? 10 : 5 }]} />
          ))}
        </View>
      </GestureDetector>
    </>
  );
}

function GuideLine({
  guide,
  box,
  onMove,
  onCommit,
}: {
  guide: ImageGuide;
  box: { w: number; h: number };
  onMove: (id: string, pos: number) => void;
  onCommit: (id: string, pos: number | null) => void;
}) {
  const dataRef = useRef({ guide, box, onMove, onCommit });
  dataRef.current = { guide, box, onMove, onCommit };
  const startRef = useRef(0);

  const pan = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .onStart(() => {
        startRef.current = dataRef.current.guide.pos;
      })
      .onUpdate((e) => {
        const d = dataRef.current;
        const delta = d.guide.axis === 'x' ? e.translationX / d.box.w : e.translationY / d.box.h;
        d.onMove(d.guide.id, startRef.current + delta);
      })
      .onEnd((e) => {
        const d = dataRef.current;
        const delta = d.guide.axis === 'x' ? e.translationX / d.box.w : e.translationY / d.box.h;
        const pos = startRef.current + delta;
        // a szélre húzva törlés
        d.onCommit(d.guide.id, pos < EDGE || pos > 1 - EDGE ? null : pos);
      })
  ).current;

  const isX = guide.axis === 'x';
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          styles.hit,
          isX
            ? { left: guide.pos * box.w - 10, top: 0, width: 20, height: box.h }
            : { top: guide.pos * box.h - 10, left: 0, height: 20, width: box.w },
        ]}
      >
        <View pointerEvents="none" style={isX ? styles.lineV : styles.lineH} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  rulerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: RULER,
    backgroundColor: 'rgba(10,11,18,0.72)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rulerLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RULER,
    backgroundColor: 'rgba(10,11,18,0.72)',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.border,
  },
  tickV: { position: 'absolute', top: 0, width: StyleSheet.hairlineWidth, backgroundColor: palette.textDim },
  tickH: { position: 'absolute', left: 0, height: StyleSheet.hairlineWidth, backgroundColor: palette.textDim },
  hit: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  lineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: palette.accent2 ?? '#00e5ff' },
  lineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: palette.accent2 ?? '#00e5ff' },
});
