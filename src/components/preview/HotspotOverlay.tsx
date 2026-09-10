import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { palette, trackColors } from '@/constants/editor';
import { clamp } from '@/lib/time';
import type { InteractiveClip } from '@/types/project';

interface Props {
  clip: InteractiveClip;
  /** klipen belüli idő (mp) — a lejátszóban a finom pulzáláshoz */
  t: number;
  box: { w: number; h: number };
  mode: 'edit' | 'play';
  selected: boolean;
  onSelect?: (id: string) => void;
  onChangeRect?: (id: string, rect: InteractiveClip['rect']) => void;
  onPress?: (clip: InteractiveClip) => void;
}

const MIN_SIZE = 0.08;

export function HotspotOverlay({
  clip,
  t,
  box,
  mode,
  selected,
  onSelect,
  onChangeRect,
  onPress,
}: Props) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const sizeX = useSharedValue(0);
  const sizeY = useSharedValue(0);

  useEffect(() => {
    dragX.value = 0;
    dragY.value = 0;
    sizeX.value = 0;
    sizeY.value = 0;
  }, [clip.rect, dragX, dragY, sizeX, sizeY]);

  const editable = mode === 'edit';

  const commitMove = (dx: number, dy: number) => {
    onChangeRect?.(clip.id, {
      ...clip.rect,
      x: clamp(clip.rect.x + dx / box.w, 0, 1 - clip.rect.w),
      y: clamp(clip.rect.y + dy / box.h, 0, 1 - clip.rect.h),
    });
  };

  const commitResize = (dw: number, dh: number) => {
    onChangeRect?.(clip.id, {
      ...clip.rect,
      w: clamp(clip.rect.w + dw / box.w, MIN_SIZE, 1 - clip.rect.x),
      h: clamp(clip.rect.h + dh / box.h, MIN_SIZE, 1 - clip.rect.y),
    });
  };

  const movePan = Gesture.Pan()
    .enabled(editable)
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX, e.translationY);
    });

  const tap = Gesture.Tap()
    .enabled(editable)
    .onEnd(() => {
      if (onSelect) {
        runOnJS(onSelect)(clip.id);
      }
    });

  const resizePan = Gesture.Pan()
    .enabled(editable && selected)
    .onUpdate((e) => {
      sizeX.value = e.translationX;
      sizeY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(commitResize)(e.translationX, e.translationY);
    });

  const animatedBox = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
    width: clip.rect.w * box.w + sizeX.value,
    height: clip.rect.h * box.h + sizeY.value,
  }));

  const color = trackColors.interactive;

  if (mode === 'play') {
    // lejátszóban: finoman pulzáló keret jelzi a kattinthatóságot
    const pulse = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    return (
      <Pressable
        onPress={() => onPress?.(clip)}
        style={[
          styles.playBox,
          {
            left: clip.rect.x * box.w,
            top: clip.rect.y * box.h,
            width: clip.rect.w * box.w,
            height: clip.rect.h * box.h,
            borderColor: `${color}${Math.round(pulse * 255)
              .toString(16)
              .padStart(2, '0')}`,
          },
        ]}
      >
        {clip.label ? (
          <View style={[styles.labelChip, { backgroundColor: color }]}>
            <Text style={styles.labelText}>{clip.label}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <GestureDetector gesture={Gesture.Simultaneous(tap, movePan)}>
      <Animated.View
        style={[
          styles.editBox,
          {
            left: clip.rect.x * box.w,
            top: clip.rect.y * box.h,
            borderColor: selected ? palette.accent : color,
          },
          animatedBox,
        ]}
      >
        <View style={[styles.labelChip, { backgroundColor: selected ? palette.accent : color }]}>
          <Text style={styles.labelText}>{clip.label || 'Hotspot'}</Text>
        </View>
        {selected ? (
          <GestureDetector gesture={resizePan}>
            <View style={[styles.resizeHandle, { backgroundColor: palette.accent }]} />
          </GestureDetector>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  editBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: '#f5a62314',
  },
  playBox: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 8,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  labelChip: {
    position: 'absolute',
    top: -12,
    left: 6,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  labelText: {
    color: '#0c0d12',
    fontSize: 10,
    fontWeight: '700',
  },
  resizeHandle: {
    position: 'absolute',
    right: -9,
    bottom: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#0c0d12',
  },
});
