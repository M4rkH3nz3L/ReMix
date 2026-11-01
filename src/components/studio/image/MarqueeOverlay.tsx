import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { ellipseRing, type Point, rectRing } from '@/lib/selection';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** ▭ Téglalap- és ellipszis-kijelölő: a húzás két sarka adja a gyűrűt, a vászonon kívülre nem lóg. */
export function MarqueeOverlay({
  box,
  shape,
  onRing,
  gestureTestId = 'marquee-pan',
}: {
  box: { w: number; h: number };
  shape: 'rect' | 'ellipse';
  onRing: (ring: Point[]) => void;
  gestureTestId?: string;
}) {
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null);
  const toPoint = (e: { x: number; y: number }) => ({ x: clamp01(e.x / box.w), y: clamp01(e.y / box.h) });
  const extend = (e: { x: number; y: number }) => setDrag((d) => (d ? { ...d, b: toPoint(e) } : d));
  const pan = Gesture.Pan()
    .withTestId(gestureTestId)
    .runOnJS(true)
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      const p = toPoint(e);
      setDrag({ a: p, b: p });
    })
    // az első mozgás az aktiváláskor érkezik: rövid, gyors húzásnál ez lehet az egyetlen
    .onStart(extend)
    .onUpdate(extend)
    .onFinalize((_e, success) => {
      setDrag((d) => {
        if (d && success) {
          onRing(shape === 'rect' ? rectRing(d.a, d.b) : ellipseRing(d.a, d.b));
        }
        return null;
      });
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        {drag ? (
          <View
            pointerEvents="none"
            style={[
              styles.frame,
              shape === 'ellipse' && styles.round,
              {
                left: Math.min(drag.a.x, drag.b.x) * box.w,
                top: Math.min(drag.a.y, drag.b.y) * box.h,
                width: Math.abs(drag.a.x - drag.b.x) * box.w,
                height: Math.abs(drag.a.y - drag.b.y) * box.h,
              },
            ]}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.accent },
  round: { borderRadius: 9999 },
});
