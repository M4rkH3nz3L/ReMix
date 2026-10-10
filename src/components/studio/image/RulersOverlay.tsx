import { useRef } from 'react';
import { PanResponder, type PanResponderInstance, StyleSheet, View } from 'react-native';

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
  const tapRef = useRef({ x: 0, y: 0 });

  const resp = useRef<{ top: PanResponderInstance; left: PanResponderInstance } | null>(null);
  if (!resp.current) {
    const makeAdd = (axis: 'x' | 'y') =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          tapRef.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        },
        onPanResponderRelease: (_e, g) => {
          if (Math.hypot(g.dx, g.dy) > 10) return;
          const d = dataRef.current;
          d.onAddGuide(axis, axis === 'x' ? tapRef.current.x / d.box.w : tapRef.current.y / d.box.h);
        },
      });
    resp.current = { top: makeAdd('x'), left: makeAdd('y') };
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
      <View style={[styles.rulerTop, { width: box.w }]} {...resp.current.top.panHandlers}>
        {xTicks.map((t, i) => (
          <View key={i} pointerEvents="none" style={[styles.tickV, { left: t.px, height: t.major ? 10 : 5 }]} />
        ))}
      </View>
      {/* bal vonalzó */}
      <View style={[styles.rulerLeft, { height: box.h }]} {...resp.current.left.panHandlers}>
        {yTicks.map((t, i) => (
          <View key={i} pointerEvents="none" style={[styles.tickH, { top: t.px, width: t.major ? 10 : 5 }]} />
        ))}
      </View>
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

  const pan = useRef<PanResponderInstance | null>(null);
  if (!pan.current) {
    pan.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = dataRef.current.guide.pos;
      },
      onPanResponderMove: (_e, g) => {
        const d = dataRef.current;
        const delta = d.guide.axis === 'x' ? g.dx / d.box.w : g.dy / d.box.h;
        d.onMove(d.guide.id, startRef.current + delta);
      },
      onPanResponderRelease: (_e, g) => {
        const d = dataRef.current;
        const delta = d.guide.axis === 'x' ? g.dx / d.box.w : g.dy / d.box.h;
        const pos = startRef.current + delta;
        // a szélre húzva törlés
        d.onCommit(d.guide.id, pos < EDGE || pos > 1 - EDGE ? null : pos);
      },
    });
  }

  const isX = guide.axis === 'x';
  return (
    <View
      style={[
        styles.hit,
        isX
          ? { left: guide.pos * box.w - 10, top: 0, width: 20, height: box.h }
          : { top: guide.pos * box.h - 10, left: 0, height: 20, width: box.w },
      ]}
      {...pan.current.panHandlers}
    >
      <View pointerEvents="none" style={isX ? styles.lineV : styles.lineH} />
    </View>
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
