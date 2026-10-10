import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 🪄 Varázspálca-overlay — a vászonra koppintva a (vászon-normalizált 0–1) pontot
 * jelenti; a hívó (ImageCanvas) megkeresi az alatta lévő fotó-réteget és a
 * dobozon belüli lokális koordinátát a Skia-szelekcióhoz.
 */
export function WandOverlay({
  box,
  onTap,
}: {
  box: { w: number; h: number };
  onTap: (nx: number, ny: number) => void;
}) {
  const tap = Gesture.Tap()
    .maxDistance(16)
    .onEnd((e) => {
      runOnJS(onTap)(clamp(e.x / box.w, 0, 1), clamp(e.y / box.h, 0, 1));
    });
  return (
    <GestureDetector gesture={tap}>
      <View style={StyleSheet.absoluteFill} />
    </GestureDetector>
  );
}
