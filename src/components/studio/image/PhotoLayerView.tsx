import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import { adjustTintLayers } from '@/lib/adjustPreview';
import { clamp } from '@/lib/time';
import type { PhotoLayer } from '@/types/project';

/**
 * 🖼️ Fotó-réteg a Kép Stúdió vásznán — húzással mozgatható, koppintásra
 * kijelölhető (a méret/forgatás a kijelölő-kereten megy). A képjavítás
 * (adjust) az előnézetben tint-rétegekkel közelít, a renderben ég be pontosan.
 */
export function PhotoLayerView({
  layer,
  box,
  selected,
  zoom = 1,
  moveRange = [0.02, 0.98],
  onSelect,
  onMove,
}: {
  layer: PhotoLayer;
  box: { w: number; h: number };
  selected: boolean;
  /** a vászon nagyítása — a képernyő-húzás ennyivel kisebb réteg-elmozdulás */
  zoom?: number;
  /** a réteg közepének mozgástere (a szerkesztőben a vásznon túlra is mehet) */
  moveRange?: [number, number];
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
}) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const commitMove = (dx: number, dy: number) => {
    onMove?.(layer.id, {
      x: clamp(layer.position.x + dx / zoom / box.w, moveRange[0], moveRange[1]),
      y: clamp(layer.position.y + dy / zoom / box.h, moveRange[0], moveRange[1]),
    });
    dragX.value = 0;
    dragY.value = 0;
  };

  // I35: csak KIJELÖLT fotó húzható (a teljes vásznas háttér ne mozduljon el véletlenül), és
  // csak egy ujjal — a kétujjas gesztus a vászon csippentéséé
  const pan = Gesture.Pan()
    .withTestId(`photo-pan-${layer.id}`)
    .enabled(selected)
    .maxPointers(1)
    .onUpdate((e) => {
      dragX.value = e.translationX / zoom;
      dragY.value = e.translationY / zoom;
    })
    .onEnd((e, success) => {
      if (success) {
        runOnJS(commitMove)(e.translationX, e.translationY);
      } else {
        dragX.value = 0;
        dragY.value = 0;
      }
    });

  const tap = Gesture.Tap().onEnd(() => {
    if (onSelect) {
      runOnJS(onSelect)(layer.id);
    }
  });

  // 🔄 forgatás + 🔁 tükrözés egy transformban (különben a dragStyle felülírná a
  // rotate-et); a tükrözés a forgatás ELŐTT (helyi tér) → a tömb VÉGÉN
  const rotDeg = layer.rotation ?? 0;
  const sx = layer.flipH ? -1 : 1;
  const sy = layer.flipV ? -1 : 1;
  // 📐 perspektíva-közelítés: X>0 → jobb él hátra (rotateY<0), Y>0 → alsó él hátra (rotateX>0)
  const pX = layer.perspectiveX ?? 0;
  const pY = layer.perspectiveY ?? 0;
  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateX: dragX.value },
      { translateY: dragY.value },
      { rotate: `${rotDeg}deg` },
      { rotateY: `${-pX * 22}deg` },
      { rotateX: `${pY * 22}deg` },
      { scaleX: sx },
      { scaleY: sy },
    ],
  }));

  const w = layer.w * box.w;
  const h = layer.h * box.h;
  const tints = layer.adjust ? adjustTintLayers(layer.adjust) : [];

  return (
    <GestureDetector gesture={Gesture.Simultaneous(tap, pan)}>
      <Animated.View
        style={[
          styles.wrap,
          {
            left: layer.position.x * box.w - w / 2,
            top: layer.position.y * box.h - h / 2,
            width: w,
            height: h,
            opacity: layer.opacity ?? 1,
          },
          dragStyle,
          selected ? styles.selected : null,
        ]}
      >
        <Image
          source={{ uri: layer.uri }}
          style={StyleSheet.absoluteFill}
          contentFit={layer.fit === 'contain' ? 'contain' : layer.fit === 'stretch' ? 'fill' : 'cover'}
        />
        {tints.map((tint, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: tint.color, opacity: tint.opacity }]}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', overflow: 'hidden' },
  selected: { borderWidth: 1, borderColor: palette.accent },
});
