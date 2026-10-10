import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import type { CanvasPoint } from '@/lib/penPath';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** az első node közelében koppintva zárjuk a path-t (px) */
const CLOSE_PX = 26;

/**
 * ✏️ Toll-overlay a vásznon — koppintásra horgonypontot ad a készülő path-hoz,
 * az ELSŐ pontra koppintva (≥3 pontnál) bezárja (kitöltött forma). A pontok
 * vászon-térben (0–1) a szülőben élnek; az overlay az élő polyline-t + a
 * node-pöttyöket rajzolja (az első node kiemelve = ide koppints a záráshoz).
 */
export function PenOverlay({
  box,
  points,
  onAddPoint,
  onClosePath,
}: {
  box: { w: number; h: number };
  points: CanvasPoint[];
  onAddPoint: (p: CanvasPoint) => void;
  onClosePath: () => void;
}) {
  const handleTap = (lx: number, ly: number) => {
    const nx = clamp(lx / box.w, 0, 1);
    const ny = clamp(ly / box.h, 0, 1);
    if (points.length >= 3) {
      const first = points[0];
      const dpx = Math.hypot((nx - first.x) * box.w, (ny - first.y) * box.h);
      if (dpx < CLOSE_PX) {
        onClosePath();
        return;
      }
    }
    onAddPoint({ x: nx, y: ny });
  };

  const tap = Gesture.Tap()
    .maxDistance(16)
    .onEnd((e) => {
      runOnJS(handleTap)(e.x, e.y);
    });

  // élő polyline a lerakott pontokon át (px)
  const d =
    points.length >= 1
      ? `M${(points[0].x * box.w).toFixed(1)},${(points[0].y * box.h).toFixed(1)}` +
        points
          .slice(1)
          .map((p) => `L${(p.x * box.w).toFixed(1)},${(p.y * box.h).toFixed(1)}`)
          .join('')
      : '';

  return (
    <GestureDetector gesture={tap}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          {d ? <Path d={d} stroke={palette.accent} strokeWidth={2} fill="none" /> : null}
          {points.map((p, i) => (
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
