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
  onSelect,
  onMove,
}: {
  layer: PhotoLayer;
  box: { w: number; h: number };
  selected: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
}) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const commitMove = (dx: number, dy: number) => {
    onMove?.(layer.id, {
      x: clamp(layer.position.x + dx / box.w, 0.02, 0.98),
      y: clamp(layer.position.y + dy / box.h, 0.02, 0.98),
    });
    dragX.value = 0;
    dragY.value = 0;
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX, e.translationY);
    });

  const tap = Gesture.Tap().onEnd(() => {
    if (onSelect) {
      runOnJS(onSelect)(layer.id);
    }
  });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
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
            transform: [{ rotate: `${layer.rotation ?? 0}deg` }],
          },
          dragStyle,
          selected ? styles.selected : null,
        ]}
      >
        <Image
          source={{ uri: layer.uri }}
          style={StyleSheet.absoluteFill}
          contentFit={layer.fit === 'contain' ? 'contain' : 'cover'}
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
