import * as Haptics from 'expo-haptics';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ClipFilmstrip } from '@/components/editor/ClipFilmstrip';
import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { MIN_CLIP_DURATION, SNAP_PX, palette, trackColors } from '@/constants/editor';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, TrackType } from '@/types/project';
import type { TFunction } from 'i18next';

interface Props {
  clip: Clip;
  trackType: TrackType;
  /** pixel / másodperc */
  pps: number;
  height: number;
  selected: boolean;
  /** 🧩 a kötegbe is bevéve (nem az elsődleges kijelölés) */
  multiSelected?: boolean;
}

function clipLabel(clip: Clip, t: TFunction): string {
  switch (clip.kind) {
    case 'video':
      return clip.speed !== 1
        ? t('editor.timelineClip.videoSpeed', { speed: clip.speed })
        : t('editor.timelineClip.video');
    case 'image':
      return t('editor.timelineClip.image');
    case 'text':
      return clip.text || t('editor.timelineClip.text');
    case 'audio':
      return clip.label || t('editor.timelineClip.audio');
    case 'interactive':
      return clip.label || t('editor.timelineClip.hotspot');
    case 'shape':
      return clip.shape === 'ellipse'
        ? t('editor.timelineClip.ellipse')
        : clip.shape === 'line'
          ? t('editor.timelineClip.line')
          : t('editor.timelineClip.rectangle');
    case 'adjust':
      return t('editor.timelineClip.grade');
  }
}

function selectionHaptic() {
  Haptics.selectionAsync().catch(() => {});
}

/**
 * Egy klip az idővonalon: koppintás = kijelölés, hosszú nyomás + húzás = mozgatás
 * (mágneses illesztés a 0-ra és a lejátszófejre), kijelölve két szélső fogantyúval
 * trimmelhető. A húzás élőben a shared value-kon fut, állapot csak elengedéskor íródik.
 */
function TimelineClipInner({
  clip,
  trackType,
  pps,
  height,
  selected,
  multiSelected,
}: Props) {
  const { t } = useTranslation();
  const selectClip = useEditorStore((s) => s.selectClip);
  const toggleMultiSelect = useEditorStore((s) => s.toggleMultiSelect);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  // 🔒 zárolt sávon a klip nem mozgatható/trimmelhető/kijelölhető
  const locked = useEditorStore((s) => s.lockedTracks.includes(trackType));
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);
  const updateClip = useEditorStore((s) => s.updateClip);
  // 🎯 fókusz mód: ha van kijelölés és ez NEM az, halványabb (kiemeli az aktívat)
  const focusMode = useEditorStore((s) => s.focusMode);
  const hasSelection = useEditorStore((s) => s.selectedClipId != null);
  const dimmed = focusMode && hasSelection && !selected && !multiSelected;

  const moveDX = useSharedValue(0);
  const leftDelta = useSharedValue(0);
  const rightDelta = useSharedValue(0);

  useEffect(() => {
    moveDX.value = 0;
    leftDelta.value = 0;
    rightDelta.value = 0;
  }, [clip.start, clip.duration, pps, moveDX, leftDelta, rightDelta]);

  /**
   * A legközelebbi rácspont, ha SNAP_PX-en belül van: a zene beatjei (P0‑2)
   * ÉS a 🔖 szerkezeti jelölők — így a klip a refrénhez/CTA-hoz is igazítható.
   */
  const nearestBeat = (t: number): number | null => {
    const state = useEditorStore.getState();
    const targets = [
      ...state.beatTimes,
      ...(state.project?.markers ?? []).map((m) => m.time),
    ];
    let best: number | null = null;
    let bestDist = SNAP_PX / pps;
    for (const b of targets) {
      const d = Math.abs(b - t);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  };

  const commitMove = (dx: number) => {
    const { playhead } = useEditorStore.getState();
    let proposed = Math.max(0, clip.start + dx / pps);
    let snapped = false;
    const snapTargets = [0, playhead, Math.max(0, playhead - clip.duration)];
    for (const target of snapTargets) {
      if (Math.abs((proposed - target) * pps) < SNAP_PX) {
        proposed = target;
        snapped = true;
        selectionHaptic();
        break;
      }
    }
    if (!snapped) {
      const beat = nearestBeat(proposed);
      if (beat !== null) {
        proposed = beat;
        selectionHaptic();
      }
    }
    moveDX.value = 0;
    // csoport-mozgatás (#58): ha ez a klip a több-kijelölés része, együtt mozog a csoport
    const st = useEditorStore.getState();
    if (
      st.multiSelectIds.length > 0 &&
      (clip.id === st.selectedClipId || st.multiSelectIds.includes(clip.id))
    ) {
      st.nudgeSelectedBy(proposed - clip.start);
      return;
    }
    updateClip(clip.id, { start: proposed });
  };

  const commitTrimLeft = (dx: number) => {
    let deltaSec = dx / pps;
    deltaSec = clamp(deltaSec, -clip.start, clip.duration - MIN_CLIP_DURATION);
    if (clip.kind === 'video') {
      // a forrásfájl elejénél tovább nem húzható vissza
      deltaSec = Math.max(deltaSec, -clip.trimIn / clip.speed);
      leftDelta.value = 0;
      updateClip(clip.id, {
        start: clip.start + deltaSec,
        duration: clip.duration - deltaSec,
        trimIn: clip.trimIn + deltaSec * clip.speed,
      });
      return;
    }
    leftDelta.value = 0;
    updateClip(clip.id, {
      start: clip.start + deltaSec,
      duration: clip.duration - deltaSec,
    });
  };

  const commitTrimRight = (dx: number) => {
    const max = clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;
    let duration = clamp(clip.duration + dx / pps, MIN_CLIP_DURATION, max);
    // a klip vége beatre igazodik, ha közel van
    const beat = nearestBeat(clip.start + duration);
    if (beat !== null) {
      const snappedDur = clamp(beat - clip.start, MIN_CLIP_DURATION, max);
      if (Math.abs(snappedDur - duration) * pps < SNAP_PX) {
        duration = snappedDur;
        selectionHaptic();
      }
    }
    rightDelta.value = 0;
    // ⏭️ ripple módban a hossz-változás tolja a mögötte lévőket (minden sávon)
    const state = useEditorStore.getState();
    if (state.rippleMode && state.rippleResize(clip.id, duration)) {
      return;
    }
    updateClip(clip.id, { duration });
  };

  // köteg-módban a koppintás hozzáad/elvesz, egyébként átvált az elsődleges
  // kijelölésre (a köteg ilyenkor elévül — lásd selectClip a store-ban)
  const handleTap = () => {
    if (locked) {
      // néma no-op helyett: elmondjuk, MIÉRT nem történik semmi + feloldás egy koppintással
      Alert.alert(
        t('editor.timelineClip.lockedTitle'),
        t('editor.timelineClip.lockedBody', { track: t('editor.track.' + trackType) }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('editor.timeline.unlock'), onPress: () => toggleTrackFlag(trackType, 'lock') },
        ]
      );
      return;
    }
    if (multiSelectMode) {
      toggleMultiSelect(clip.id);
      selectionHaptic();
      return;
    }
    selectClip(clip.id);
  };

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const movePan = Gesture.Pan()
    .enabled(!locked)
    .activateAfterLongPress(220)
    .onStart(() => {
      runOnJS(selectionHaptic)();
      runOnJS(selectClip)(clip.id);
    })
    .onUpdate((e) => {
      moveDX.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX);
    });

  const trimLeftPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      leftDelta.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitTrimLeft)(e.translationX);
    });

  const trimRightPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      rightDelta.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitTrimRight)(e.translationX);
    });

  const baseWidth = clip.duration * pps;
  const color = trackColors[trackType];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveDX.value + leftDelta.value }],
    width: Math.max(12, baseWidth - leftDelta.value + rightDelta.value),
  }));

  return (
    <GestureDetector gesture={Gesture.Race(movePan, tap)}>
      <Animated.View
        style={[
          styles.clip,
          {
            left: clip.start * pps,
            height: height - 8,
            // a szöveg-jellegű klip tömör pill-chip (látványterv), a média
            // klipek áttetsző keretesek a filmstrip/hullámforma alatt; a
            // hangklip telt, sötétebb blokk a markáns hullám alatt
            backgroundColor:
              clip.kind === 'text'
                ? `${color}d9`
                : clip.kind === 'audio'
                  ? `${color}3d`
                  : `${color}33`,
            borderColor: selected
              ? palette.text
              : multiSelected
                ? palette.accent
                : `${color}aa`,
            borderWidth: selected || multiSelected ? 2 : 1,
            // zárolt sáv halványabb; fókusz módban a nem-kijelöltek elhalványulnak
            opacity: locked ? 0.55 : dimmed ? 0.3 : 1,
          },
          clip.kind === 'text' ? styles.clipPill : null,
          animatedStyle,
        ]}
      >
        {clip.kind === 'video' || clip.kind === 'image' ? (
          <ClipFilmstrip clip={clip} widthPx={baseWidth} heightPx={height - 8} />
        ) : null}
        {clip.kind === 'audio' ? (
          <ClipWaveform clip={clip} widthPx={baseWidth} heightPx={height - 8} color={color} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            {
              color:
                selected || clip.kind === 'text' || clip.kind === 'audio'
                  ? '#fff'
                  : `${color}`,
            },
            // média-háttér (filmstrip/hullámforma) fölött chip tartja olvashatónak
            clip.kind !== 'text' && clip.kind !== 'interactive' ? styles.labelChip : null,
            // hangklipen a fájlnév kis címke a bal-felső sarokban — a
            // hullámforma marad a főszereplő (látványterv szerint)
            clip.kind === 'audio' ? styles.labelAudio : null,
          ]}
        >
          {clipLabel(clip, t)}
        </Text>
        {selected ? (
          <>
            <GestureDetector gesture={trimLeftPan}>
              <View style={[styles.handle, styles.handleLeft]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={trimRightPan}>
              <View style={[styles.handle, styles.handleRight]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
          </>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: 10,
    overflow: 'visible',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  labelChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#07080dcc',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  labelAudio: {
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: 9,
    fontWeight: '700',
  },
  clipPill: {
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  handle: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.text,
  },
  handleLeft: {
    left: -10,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  handleRight: {
    right: -10,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  handleBar: {
    width: 2,
    height: '40%',
    borderRadius: 1,
    backgroundColor: palette.bg,
  },
});

/**
 * Lejátszás közben a playhead 60×/mp frissíti a Timeline-t — a klipek propjai
 * ilyenkor változatlanok, a memo a teljes klipfa újrarenderét spórolja meg.
 */
export const TimelineClip = memo(TimelineClipInner);
