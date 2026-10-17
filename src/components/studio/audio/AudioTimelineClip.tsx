import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { palette } from '@/constants/editor';
import { gestures, haptics, motion } from '@/design';
import { trimAudioLeft, trimAudioRight } from '@/lib/audioTrim';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/**
 * 🎧 Egy audio-klip az idővonalon — gesztus-vezérelt (Touch/04).
 *
 * - koppintás = kijelölés + a lejátszófej a klip elejére;
 * - HOSSZÚ NYOMÁS + húzás (a klip testén) = vízszintes repozicionálás;
 * - a KIJELÖLT klip két szélén TRIM-fogantyú: a szél-húzás a be/ki-pontot állítja
 *   (a forrás-hosszon belül), NEM mozgatja az egész klipet.
 *
 * A húzás/trim ÉLŐBEN a shared value-kon fut (UI-szál); az állapot CSAK
 * elengedéskor íródik a command-buson át (`updateClip`, egy undo-lépés) — a videó
 * `TimelineClip` bizonyított mintáját követve. A snap a transport frame/beat-módja
 * szerint, a küszöbök a `@/design` gestures-ből (render-időben olvasva).
 *
 * NYITOTT (Touch/04 következő increment): sáv-váltás (függőleges drag), pinch-zoom.
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
  // élő eltolások (px): test-mozgatás + bal/jobb trim; a „lift" visszajelzi a fogást
  const moveDX = useSharedValue(0);
  const leftDelta = useSharedValue(0);
  const rightDelta = useSharedValue(0);
  const lift = useSharedValue(0);

  // committed állapot után a vizuális eltolások nullázódnak (a klip a helyén áll)
  useEffect(() => {
    moveDX.value = 0;
    leftDelta.value = 0;
    rightDelta.value = 0;
  }, [clip.start, clip.duration, pxPerSec, moveDX, leftDelta, rightDelta]);

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

  const commitTrimLeft = (dx: number) => {
    leftDelta.value = 0;
    const snappedStart = Math.max(0, snap(clip.start + dx / pxPerSec));
    const patch = trimAudioLeft(clip, snappedStart - clip.start);
    if (Math.abs(patch.start - clip.start) > 1e-4 || Math.abs(patch.duration - clip.duration) > 1e-4) {
      useEditorStore.getState().updateClip(clip.id, patch);
      haptics.snap();
    }
  };

  const commitTrimRight = (dx: number) => {
    rightDelta.value = 0;
    const snappedEnd = snap(clip.start + clip.duration + dx / pxPerSec);
    const patch = trimAudioRight(clip, snappedEnd - clip.start);
    if (Math.abs(patch.duration - clip.duration) > 1e-4) {
      useEditorStore.getState().updateClip(clip.id, patch);
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
  const bodyGesture = Gesture.Race(movePan, tap);

  // a trim-fogantyúk SAJÁT pan-je (nincs long-press → azonnal aktiválódik a szélen,
  // és NEM mozgatja az egész klipet). A hitSlop a kényelmes érintésért.
  const trimLeftPan = Gesture.Pan()
    .hitSlop({ left: 10, top: 6, bottom: 6 })
    .onUpdate((e) => {
      leftDelta.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitTrimLeft)(e.translationX);
    });

  const trimRightPan = Gesture.Pan()
    .hitSlop({ right: 10, top: 6, bottom: 6 })
    .onUpdate((e) => {
      rightDelta.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitTrimRight)(e.translationX);
    });

  const left = clip.start * pxPerSec;
  const w = Math.max(20, clip.duration * pxPerSec);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveDX.value + leftDelta.value }, { scale: 1 + lift.value * 0.03 }],
    width: Math.max(20, w + rightDelta.value - leftDelta.value),
  }));

  return (
    <GestureDetector gesture={bodyGesture}>
      <Animated.View
        style={[styles.clip, { left, borderColor: selected ? '#fff' : `${laneColor}99` }, animStyle]}
      >
        <View style={[styles.clipFill, { backgroundColor: `${laneColor}26` }]}>
          <ClipWaveform clip={clip} widthPx={w} heightPx={laneH - 22} color={laneColor} />
        </View>
        <Text style={styles.clipLabel} numberOfLines={1}>
          {clip.label}
        </Text>
        {selected ? (
          <>
            <GestureDetector gesture={trimLeftPan}>
              <View style={[styles.handle, styles.handleLeft]}>
                <View style={styles.grip} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={trimRightPan}>
              <View style={[styles.handle, styles.handleRight]}>
                <View style={styles.grip} />
              </View>
            </GestureDetector>
          </>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 6, bottom: 6, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden', justifyContent: 'center' },
  clipFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clipLabel: { color: palette.text, fontSize: 10, fontWeight: '700', paddingHorizontal: 6 },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 16, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  handleLeft: { left: 0 },
  handleRight: { right: 0 },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
});
