import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { anchorFromDrag, type CanvasPoint } from '@/lib/penPath';
import { pointsToSvgPath } from '@/lib/vectorPath';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** az első node közelében koppintva zárjuk a path-t (px) */
const CLOSE_PX = 26;

/**
 * ✏️ Toll-overlay a vásznon — koppintásra sarokpontot, húzásra görbe csomópontot ad a készülő
 * path-hoz (a húzás a kimenő fogantyú, a bejövő a tükörképe); az ELSŐ pontra koppintva (≥3 pontnál)
 * bezárja. A pontok vászon-térben (0–1) a szülőben élnek; az overlay az élő görbét, a pöttyöket és
 * a húzott fogantyút rajzolja.
 */
export function PenOverlay({
  box,
  points,
  onAddPoint,
  onClosePath,
  gestureTestId = 'pen-pan',
}: {
  box: { w: number; h: number };
  points: CanvasPoint[];
  onAddPoint: (p: CanvasPoint) => void;
  onClosePath: () => void;
  gestureTestId?: string;
}) {
  const [draft, setDraft] = useState<CanvasPoint | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const norm = (e: { x: number; y: number }) => ({ x: clamp(e.x / box.w, 0, 1), y: clamp(e.y / box.h, 0, 1) });
  const update = (e: { x: number; y: number }) => {
    if (start.current) {
      setDraft(anchorFromDrag(start.current, norm(e), box));
    }
  };

  const pan = Gesture.Pan()
    .withTestId(gestureTestId)
    .runOnJS(true)
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      start.current = norm(e);
      setDraft(start.current);
    })
    .onStart(update)
    .onUpdate(update)
    .onFinalize((e, success) => {
      const anchor = start.current;
      start.current = null;
      setDraft(null);
      if (!anchor || !success) {
        return;
      }
      const placed = anchorFromDrag(anchor, norm(e), box);
      if (points.length >= 3 && !placed.h2 && Math.hypot((anchor.x - points[0].x) * box.w, (anchor.y - points[0].y) * box.h) < CLOSE_PX) {
        onClosePath();
        return;
      }
      onAddPoint(placed);
    });

  // élő görbe a lerakott pontokon át (px)
  const all = draft ? [...points, draft] : points;
  const px = (p: { x: number; y: number }) => ({ x: p.x * box.w, y: p.y * box.h });
  const d = all.length >= 1 ? pointsToSvgPath(all.map((p) => ({ ...px(p), h1: p.h1 && px(p.h1), h2: p.h2 && px(p.h2) }))) : '';

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          {d ? <Path d={d} stroke={palette.accent} strokeWidth={2} fill="none" /> : null}
          {draft?.h1 && draft.h2 ? (
            <>
              <Line x1={draft.h1.x * box.w} y1={draft.h1.y * box.h} x2={draft.h2.x * box.w} y2={draft.h2.y * box.h} stroke={palette.accent} strokeWidth={1} />
              <Circle cx={draft.h1.x * box.w} cy={draft.h1.y * box.h} r={4} fill={palette.accent} />
              <Circle cx={draft.h2.x * box.w} cy={draft.h2.y * box.h} r={4} fill={palette.accent} />
            </>
          ) : null}
          {all.map((p, i) => (
            <Circle
              key={i}
              cx={p.x * box.w}
              cy={p.y * box.h}
              r={i === 0 ? 7 : 5}
              fill={i === 0 ? palette.accent : '#ffffff'}
              stroke={palette.accent}
              strokeWidth={2}
            />
          ))}
        </Svg>
      </View>
    </GestureDetector>
  );
}
