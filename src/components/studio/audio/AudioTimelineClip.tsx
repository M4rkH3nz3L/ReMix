import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { palette } from '@/constants/editor';
import { gestures, haptics, motion } from '@/design';
import { audioLaneTarget } from '@/lib/audioTimelineGestures';
import { makeId } from '@/lib/id';
import { trimAudioLeft, trimAudioRight } from '@/lib/audioTrim';
import { useActionMenu } from '@/store/actionMenuStore';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, TrackType } from '@/types/project';

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
 * A függőleges húzás sávot vált (`audioLaneTarget`), a kétujjas csippentés az idővonalon zoomol.
 */
export const AudioTimelineClip = memo(function AudioTimelineClip({
  clip,
  pxPerSec,
  laneColor,
  laneH,
  laneType,
  laneTypes,
  selected,
  multiSelected = false,
  snap,
}: {
  clip: AudioClip;
  pxPerSec: number;
  laneColor: string;
  laneH: number;
  /** ennek a sávnak a típusa (a sáv-váltás kiindulása) */
  laneType: TrackType;
  /** a sávok típusai fentről le (zene/voiceover/sfx) — a sáv-váltás cél-sávjához */
  laneTypes: TrackType[];
  selected: boolean;
  multiSelected?: boolean;
  /** frame/beat-illesztés a transport snap-módja szerint (AudioStudioBody adja) */
  snap: (sec: number) => number;
}) {
  const { t } = useTranslation();
  // élő eltolások (px): test-mozgatás + bal/jobb trim; a „lift" visszajelzi a fogást
  const moveDX = useSharedValue(0);
  const moveDY = useSharedValue(0);
  const leftDelta = useSharedValue(0);
  const rightDelta = useSharedValue(0);
  const lift = useSharedValue(0);
  // 🔒 A47: a videó-szerkesztővel közös sáv-zár itt is érvényes, és látszik
  const locked = useEditorStore((s) => s.lockedTracks.includes(laneType));

  // committed állapot után a vizuális eltolások nullázódnak (a klip a helyén áll)
  useEffect(() => {
    moveDX.value = 0;
    moveDY.value = 0;
    leftDelta.value = 0;
    rightDelta.value = 0;
  }, [clip.start, clip.duration, pxPerSec, moveDX, moveDY, leftDelta, rightDelta]);

  const selectAndSeek = () => {
    const st = useEditorStore.getState();
    if (locked) {
      // A47: a videó-szerkesztőben zárolt sáv itt sem szerkeszthető — de nem némán
      Alert.alert(t('editor.timelineClip.lockedTitle'), t('editor.timelineClip.lockedBody', { track: t('editor.track.' + laneType) }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('editor.timeline.unlock'), onPress: () => useEditorStore.getState().toggleTrackFlag(laneType, 'lock') },
      ]);
      return;
    }
    if (st.multiSelectMode) {
      st.toggleMultiSelect(clip.id);
      haptics.snap();
      return;
    }
    st.selectClip(clip.id);
    st.setPlayhead(clip.start);
  };

  // hosszú nyomás mozgás nélkül: a videóval azonos menü
  const showMenu = () => {
    const st = useEditorStore.getState();
    haptics.impact();
    const onClip = st.playhead > clip.start && st.playhead < clip.start + clip.duration;
    useActionMenu.getState().open(clip.label, [
      { label: t('editor.toolbar.multiSelectTitle'), icon: 'checkmark-done-outline', onPress: () => st.beginMultiSelect(clip.id) },
      { label: t('editor.toolbar.splitHere'), icon: 'cut-outline', onPress: () => st.splitClipAt(clip.id, onClip ? st.playhead : clip.start + clip.duration / 2) },
      { label: t('common.duplicate'), icon: 'copy-outline', onPress: () => st.addClip(laneType, { ...clip, id: makeId('clip'), start: clip.start + clip.duration }) },
      { label: t('common.delete'), icon: 'trash-outline', destructive: true, onPress: () => st.removeClip(clip.id) },
    ]);
  };

  // a húzás és a menü a klipre vonatkozik, többes kijelölésben sem ad hozzá
  const selectForMove = () => {
    const st = useEditorStore.getState();
    if (!st.multiSelectMode) {
      st.selectClip(clip.id);
    }
  };

  const cancelMove = () => {
    moveDX.value = 0;
    moveDY.value = 0;
  };

  const commitMove = (dx: number, dy: number) => {
    moveDX.value = 0;
    moveDY.value = 0;
    const next = Math.max(0, snap(clip.start + dx / pxPerSec));
    // ↕️ függőleges szándék → szomszédos sávra (a moveClip ellenőrzi a kompatibilitást;
    // inkompatibilis vagy nincs-hova esetben no-op → marad a vízszintes mozgatás)
    const curIdx = laneTypes.indexOf(laneType);
    const tgtIdx = audioLaneTarget(curIdx, dy, laneH, laneTypes.length);
    if (curIdx >= 0 && tgtIdx !== curIdx) {
      if (useEditorStore.getState().moveClip(clip.id, laneTypes[tgtIdx], next, true)) {
        haptics.snap();
        return;
      }
    }
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
    .withTestId(`audio-clip-tap-${clip.id}`)
    .maxDistance(gestures.slop.tap)
    .onEnd(() => {
      runOnJS(selectAndSeek)();
    });

  const movePan = Gesture.Pan()
    .withTestId(`audio-clip-move-${clip.id}`)
    .enabled(!locked)
    .activateAfterLongPress(gestures.longPress.drag)
    .onStart(() => {
      lift.value = withSpring(1, motion.spring.snappy);
      runOnJS(selectForMove)();
    })
    .onUpdate((e) => {
      moveDX.value = e.translationX;
      moveDY.value = e.translationY;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) < gestures.slop.pan && Math.abs(e.translationY) < gestures.slop.pan) {
        runOnJS(cancelMove)();
        runOnJS(showMenu)();
      } else {
        runOnJS(commitMove)(e.translationX, e.translationY);
      }
    })
    .onFinalize(() => {
      lift.value = withSpring(0, motion.spring.snappy);
    });

  // tap VAGY long-press-húzás — egyszerre csak az egyik nyer (nincs véletlen dupla)
  const bodyGesture = Gesture.Race(movePan, tap);

  // a trim-fogantyúk SAJÁT pan-je (nincs long-press → azonnal aktiválódik a szélen,
  // és NEM mozgatja az egész klipet). A hitSlop a kényelmes érintésért.
  const trimLeftPan = Gesture.Pan()
    .enabled(!locked)
    .hitSlop({ left: 10, top: 6, bottom: 6 })
    .onUpdate((e) => {
      leftDelta.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitTrimLeft)(e.translationX);
    });

  const trimRightPan = Gesture.Pan()
    .enabled(!locked)
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
    transform: [
      { translateX: moveDX.value + leftDelta.value },
      { translateY: moveDY.value },
      { scale: 1 + lift.value * 0.03 },
    ],
    width: Math.max(20, w + rightDelta.value - leftDelta.value),
  }));

  return (
    <GestureDetector gesture={bodyGesture}>
      <Animated.View
        style={[styles.clip, { left, borderColor: selected || multiSelected ? '#fff' : `${laneColor}99`, opacity: locked ? 0.55 : 1 }, animStyle]}
      >
        <View style={[styles.clipFill, { backgroundColor: `${laneColor}26` }]}>
          <ClipWaveform clip={clip} widthPx={w} heightPx={laneH - 22} color={laneColor} userInitiated />
        </View>
        {/* kijelölve a 16 pt-os trim-fogók ne takarják a címke elejét/végét (élő teszt H-a) */}
        <Text style={[styles.clipLabel, selected ? styles.clipLabelSelected : null]} numberOfLines={1}>
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
  clipLabelSelected: { paddingHorizontal: 20 },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 16, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  handleLeft: { left: 0 },
  handleRight: { right: 0 },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
});
