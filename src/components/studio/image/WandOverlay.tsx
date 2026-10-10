import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

/**
 * 🪄 Varázspálca-overlay — a vászonra koppintva a (vászon-normalizált 0–1) pontot
 * jelenti; a hívó (ImageCanvas) megkeresi az alatta lévő fotó-réteget és a
 * dobozon belüli lokális koordinátát a Skia-szelekcióhoz. A koppintás a vásznon
 * belül esik → e.x/box.w már 0–1; a clampelést a JS-oldali `onTap` végzi (a Tap
 * worklet-jéből nem hívhatunk sima JS-függvényt).
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
      runOnJS(onTap)(e.x / box.w, e.y / box.h);
    });
  return (
    <GestureDetector gesture={tap}>
      <View style={StyleSheet.absoluteFill} />
    </GestureDetector>
  );
}
