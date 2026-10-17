import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import type { CanvasPoint } from '@/lib/penPath';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** mintavétel-ritkítás: csak ennyi vászon-arány után veszünk új pontot */
const MIN_STEP = 0.014;

/**
 * 🪢 Lasszó-overlay — SZABADKÉZI húzás a vásznon: a mozgás mentén pontokat
 * mintavételez (ritkítva), felengedésre ZÁRT path-formát ad vissza (`onComplete`).
 * Az élő körvonalat rajzolja húzás közben. A pontok vászon-térben (0–1).
 *
 * Gesztus: modern react-native-gesture-handler (Touch/03). A `Gesture.Pan` EGYSZER
 * jön létre (stabil handler), a friss propokat a `dataRef`-ből olvassa; `minDistance(0)`
 * → a rajz már a lenyomásnál indul (nincs aktiválási küszöb). `runOnJS(true)`: a
 * callbackek a JS-szálon (setState). A `GestureDetector` `e.x/e.y`-a a nézethez
 * képesti lokális koordináta (= a korábbi `locationX/Y`).
 */
export function LassoOverlay({
  box,
  onComplete,
  onCancel,
}: {
  box: { w: number; h: number };
  onComplete: (points: CanvasPoint[]) => void;
  onCancel: () => void;
}) {
  const [pts, setPts] = useState<CanvasPoint[]>([]);
  const ptsRef = useRef<CanvasPoint[]>([]);
  const dataRef = useRef({ box, onComplete, onCancel });
  dataRef.current = { box, onComplete, onCancel };

  const pan = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onStart((e) => {
        const { box: b } = dataRef.current;
        const p = { x: clamp(e.x / b.w, 0, 1), y: clamp(e.y / b.h, 0, 1) };
        ptsRef.current = [p];
        setPts([p]);
      })
      .onUpdate((e) => {
        const { box: b } = dataRef.current;
        const p = { x: clamp(e.x / b.w, 0, 1), y: clamp(e.y / b.h, 0, 1) };
        const last = ptsRef.current[ptsRef.current.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > MIN_STEP) {
          ptsRef.current = [...ptsRef.current, p];
          setPts(ptsRef.current);
        }
      })
      .onEnd(() => {
        const d = dataRef.current;
        if (ptsRef.current.length >= 3) {
          d.onComplete(ptsRef.current);
        } else {
          d.onCancel();
        }
        ptsRef.current = [];
        setPts([]);
      })
      .onFinalize((_e, success) => {
        // megszakadt gesztus (nem rendes felengedés) → mégse, ne ragadjon bent félkész körvonal
        if (!success) {
          if (ptsRef.current.length > 0) {
            dataRef.current.onCancel();
          }
          ptsRef.current = [];
          setPts([]);
        }
      })
  ).current;

  const d =
    pts.length >= 1
      ? `M${(pts[0].x * box.w).toFixed(1)},${(pts[0].y * box.h).toFixed(1)}` +
        pts
          .slice(1)
          .map((p) => `L${(p.x * box.w).toFixed(1)},${(p.y * box.h).toFixed(1)}`)
          .join('') +
        (pts.length >= 3 ? 'Z' : '')
      : '';

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        {d ? (
          <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path d={d} stroke={palette.accent} strokeWidth={2} strokeDasharray="6 4" fill={`${palette.accent}22`} />
          </Svg>
        ) : null}
      </View>
    </GestureDetector>
  );
}
