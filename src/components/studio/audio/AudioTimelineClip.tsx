import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { palette } from '@/constants/editor';
import { gestures, haptics, motion } from '@/design';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/**
 * 🎧 Egy audio-klip az idővonalon — gesztus-vezérelt (Touch/04).
 *
 * - koppintás = kijelölés + a lejátszófej a klip elejére;
 * - HOSSZÚ NYOMÁS + húzás = vízszintes repozicionálás (snap a transport
 *   frame/beat-módja szerint, haptikával).
 *
 * A húzás ÉLŐBEN a shared value-n fut (UI-szál); az állapot CSAK elengedéskor
 * íródik — egy undo-lépés, a command-buson át (`updateClip({ start })`) —, pont
 * mint a videó-idővonalon (`TimelineClip`). A küszöbök a `@/design` gestures-ből.
 *
 * NYITOTT (Touch/04 következő increment): trim-fogantyúk, sáv-váltás, pinch-zoom.
 */
export const AudioTimelineClip = memo(function AudioTimelineClip({
  clip,
  pxPerSec,
  laneColor,
  laneH,
  selected,
  snap,
}: {
  clip: AudioClip;
  pxPerSec: number;
  laneColor: string;
  laneH: number;
  selected: boolean;
  /** frame/beat-illesztés a transport snap-módja szerint (AudioStudioBody adja) */
  snap: (sec: number) => number;
}) {
  // húzás-eltolás (px) élőben; a scale „lift" visszajelzi, hogy épp fogjuk a klipet
  const moveDX = useSharedValue(0);
  const lift = useSharedValue(0);

  // új pozíció/zoom után a vizuális eltolás nullázódik (a klip a committed helyén áll)
  useEffect(() => {
    moveDX.value = 0;
  }, [clip.start, clip.duration, pxPerSec, moveDX]);

  const selectAndSeek = () => {
    const st = useEditorStore.getState();
    st.selectClip(clip.id);
    st.setPlayhead(clip.start);
  };

  const commitMove = (dx: number) => {
    moveDX.value = 0;
    const next = Math.max(0, snap(clip.start + dx / pxPerSec));
    if (Math.abs(next - clip.start) > 1e-4) {
      useEditorStore.getState().updateClip(clip.id, { start: next });
      haptics.snap();
    }
  };

  const tap = Gesture.Tap()
    .maxDistance(gestures.slop.tap)
    .onEnd(() => {
      runOnJS(selectAndSeek)();
    });

  const movePan = Gesture.Pan()
    .activateAfterLongPress(gestures.longPress.drag)
    .onStart(() => {
      lift.value = withSpring(1, motion.spring.snappy);
      runOnJS(selectAndSeek)();
    })
    .onUpdate((e) => {
      moveDX.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX);
    })
    .onFinalize(() => {
      lift.value = withSpring(0, motion.spring.snappy);
    });

  // tap VAGY long-press-húzás — egyszerre csak az egyik nyer (nincs véletlen dupla)
  const gesture = Gesture.Race(movePan, tap);

  const left = clip.start * pxPerSec;
  const w = Math.max(20, clip.duration * pxPerSec);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveDX.value }, { scale: 1 + lift.value * 0.03 }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.clip, { left, width: w, borderColor: selected ? '#fff' : `${laneColor}99` }, animStyle]}
      >
        <View style={[styles.clipFill, { backgroundColor: `${laneColor}26` }]}>
          <ClipWaveform clip={clip} widthPx={w} heightPx={laneH - 22} color={laneColor} />
        </View>
        <Text style={styles.clipLabel} numberOfLines={1}>
          {clip.label}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 6, bottom: 6, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden', justifyContent: 'center' },
  clipFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clipLabel: { color: palette.text, fontSize: 10, fontWeight: '700', paddingHorizontal: 6 },
});
