import { gestures, motion } from '@/design';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ClipFilmstrip } from '@/components/editor/ClipFilmstrip';
import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { ClipEdgePreview } from '@/components/editor/timelineClip/ClipEdgePreview';
import { ClipLabel } from '@/components/editor/timelineClip/ClipLabel';
import { ClipLockBadge } from '@/components/editor/timelineClip/ClipLockBadge';
import { ClipTrimHandles } from '@/components/editor/timelineClip/ClipTrimHandles';
import { createTimelineClipHandlers, selectionHaptic } from '@/components/editor/timelineClip/timelineClipHandlers';
import { palette, trackColors } from '@/constants/editor';
import type { ClipEdgePreviewState } from '@/lib/timelineClipOps';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, TrackType } from '@/types/project';

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

/**
 * Egy klip az idővonalon: koppintás = kijelölés, hosszú nyomás + húzás = mozgatás
 * (mágneses illesztés a 0-ra és a lejátszófejre), kijelölve két szélső fogantyúval
 * trimmelhető. A húzás élőben a shared value-kon fut, állapot csak elengedéskor íródik.
 * A gesztus-célpontok: timelineClip/timelineClipHandlers; a tiszta számítás: lib/timelineClipOps.
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
  // ✂️ trim-mód (normal/ripple/roll/slip/slide) — a fogantyú és a test-húzás viselkedése
  const trimMode = useEditorStore((s) => s.trimMode);
  // 🎯 fókusz mód: ha van kijelölés és ez NEM az, halványabb (kiemeli az aktívat)
  const focusMode = useEditorStore((s) => s.focusMode);
  const hasSelection = useEditorStore((s) => s.selectedClipId != null);
  // 🔒 collab: ezt a klipet MÁS szerkeszti-e épp? A tulaj-egyezést nézzük (tiszta,
  // render-biztos) — az elavult zárakat a collab-store prune-időzítője (10 mp) kiveszi
  // a térképből, így egy JELENLÉVŐ más-tulajú zár „élő" (nem kell render-beli idő).
  const clipLock = useEditorStore((s) => s.clipLocks[clip.id]);
  const collabSelfId = useEditorStore((s) => s.collabSelf?.id ?? null);
  const lockedByOther = !!collabSelfId && !!clipLock && clipLock.ownerId !== collabSelfId;
  const dimmed = focusMode && hasSelection && !selected && !multiSelected;

  // 🔍 clip-edge preview: trim közben a szélen lévő képkocka + időkód lebeg
  const [edge, setEdge] = useState<ClipEdgePreviewState | null>(
    null
  );

  const moveDX = useSharedValue(0);
  // ↕️ függőleges húzás-eltolás (drag-to-track): a klip élőben követi az ujjat,
  // elengedéskor a szomszédos kompatibilis sávra lép (lásd commitMove)
  const moveDY = useSharedValue(0);
  const leftDelta = useSharedValue(0);
  const rightDelta = useSharedValue(0);
  // 🫳 „lift": húzás közben a klip finoman felemelkedik (scale + árnyék), hogy a
  // felhasználó lássa, épp fogja — elengedéskor visszapattan (motion.spring.snappy).
  const lift = useSharedValue(0);

  useEffect(() => {
    moveDX.value = 0;
    moveDY.value = 0;
    leftDelta.value = 0;
    rightDelta.value = 0;
  }, [clip.start, clip.duration, pps, moveDX, moveDY, leftDelta, rightDelta]);

  // 🖐️ a gesztusok JS-oldali célpontjai (commit, edge preview, koppintás, menü)
  const {
    commitMove,
    commitTrimLeft,
    commitTrimRight,
    previewLeft,
    previewRight,
    clearEdge,
    handleTap,
    showClipMenu,
  } = createTimelineClipHandlers({
    clip,
    trackType,
    pps,
    height,
    locked,
    trimMode,
    multiSelectMode,
    selectClip,
    toggleMultiSelect,
    toggleTrackFlag,
    updateClip,
    t,
    setEdge,
    moveDX,
    leftDelta,
    rightDelta,
  });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const movePan = Gesture.Pan()
    .enabled(!locked)
    .activateAfterLongPress(gestures.longPress.drag)
    .onStart(() => {
      lift.value = withSpring(1, motion.spring.snappy);
      runOnJS(selectionHaptic)();
      runOnJS(selectClip)(clip.id);
    })
    .onUpdate((e) => {
      moveDX.value = e.translationX;
      moveDY.value = e.translationY;
    })
    .onEnd((e) => {
      // hold + elengedés mozgás nélkül (< pan-küszöb) → kontextusmenü; különben klip-mozgatás
      if (Math.abs(e.translationX) < gestures.slop.pan && Math.abs(e.translationY) < gestures.slop.pan) {
        runOnJS(showClipMenu)();
      } else {
        runOnJS(commitMove)(e.translationX, e.translationY);
      }
    })
    .onFinalize(() => {
      lift.value = withSpring(0, motion.spring.snappy);
      moveDY.value = withSpring(0, motion.spring.snappy);
    });

  const trimLeftPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      leftDelta.value = e.translationX;
      runOnJS(previewLeft)(e.translationX);
    })
    .onEnd((e) => {
      runOnJS(commitTrimLeft)(e.translationX);
    })
    .onFinalize(() => {
      runOnJS(clearEdge)();
    });

  const trimRightPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      rightDelta.value = e.translationX;
      runOnJS(previewRight)(e.translationX);
    })
    .onEnd((e) => {
      runOnJS(commitTrimRight)(e.translationX);
    })
    .onFinalize(() => {
      runOnJS(clearEdge)();
    });

  const baseWidth = clip.duration * pps;
  const color = trackColors[trackType];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: moveDX.value + leftDelta.value },
      // ↕️ drag-to-track: a klip élőben követi az ujjat függőlegesen is
      { translateY: moveDY.value },
      { scale: 1 + lift.value * 0.04 },
    ],
    width: Math.max(12, baseWidth - leftDelta.value + rightDelta.value),
    // az árnyék csak húzás közben látszik — nyugalomban a klip lapos marad
    shadowOpacity: lift.value * 0.4,
    shadowRadius: 6 + lift.value * 8,
    elevation: lift.value * 8,
    zIndex: lift.value > 0 ? 30 : 0,
  }));

  // 🎞️ filmszalagos klip + általános (információ nélküli) címke → a címke csak kijelöléskor (D10)
  const mediaThumb = clip.kind === 'video' || clip.kind === 'image';
  const genericMediaLabel = clip.kind === 'image' || (clip.kind === 'video' && !clip.comp && clip.speed === 1);

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
        {lockedByOther ? <ClipLockBadge clipLock={clipLock} /> : null}
        {/* 🎞️ a filmszalagos klipen az általános „Videó/Kép" felirat CSAK kijelöléskor látszik —
            különben a bélyegképet takarná (D10); az informatív címke (sebesség, összetett klip)
            kicsi, áttetsző sarok-chip */}
        {mediaThumb && genericMediaLabel && !selected ? null : (
          <ClipLabel clip={clip} selected={selected} color={color} mediaThumb={mediaThumb} t={t} />
        )}
        {selected ? <ClipTrimHandles trimLeftPan={trimLeftPan} trimRightPan={trimRightPan} /> : null}
        {/* 🔍 clip-edge preview: a vágott szélen lévő képkocka + időkód */}
        {edge ? <ClipEdgePreview clip={clip} edge={edge} /> : null}
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
    // a húzás-„lift" árnyékának bázisa (az opacity/radius animált, 0-ról indul)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
  },
  clipPill: {
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});

/**
 * Lejátszás közben a playhead 60×/mp frissíti a Timeline-t — a klipek propjai
 * ilyenkor változatlanok, a memo a teljes klipfa újrarenderét spórolja meg.
 */
export const TimelineClip = memo(TimelineClipInner);
