import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { aspectValue } from '@/constants/editor';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { makeId } from '@/lib/id';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import { bakeTextToImage } from '@/lib/textBake';
import { trackSegmentEnd } from '@/lib/textPanelOps';
import { pointsToPositionKeyframes, trackSubject } from '@/lib/track';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

/**
 * A szöveg-panel hook nélküli akció-gyárai (REFACTOR: a TextPanel.tsx-ből): a
 * gyökér állapotát és settereit kapják, a store-t a hívás pillanatában olvassák.
 */

export interface TrackActionDeps {
  clip: TextClip;
  trackStatus: string | null;
  setTrackStatus: (status: string | null) => void;
  tr: TFunction;
}

/** 🎯 követés a playheadtől / pontból / arcról */
export function createTrackActions({ clip, trackStatus, setTrackStatus, tr }: TrackActionDeps) {
  /**
   * Követés (P0‑6): a playhead alatti videón a szöveg pozíciójánál (vagy a
   * megadott pontnál — pl. detektált arcnál) lévő pontot követi a worker; az
   * elmozdulás a szöveg pozíció-kulcskockáiba kerül (delta-mozgás).
   */
  const startTracking = async (point?: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    if (!state.project || trackStatus) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackPlayheadOnVideo'));
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackPlayheadUnderText'));
      return;
    }
    // a szakasz: a playheadtől a szöveg és a videó közös végéig (max 15 mp)
    const endTimeline = trackSegmentEnd(clip, video, state.playhead);
    const durationTimeline = endTimeline - state.playhead;
    if (durationTimeline < 0.5) {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackTooShort'));
      return;
    }
    const ar = aspectValue(state.project.aspectRatio);
    setTrackStatus(tr('panels.text.trackingStatus'));
    try {
      const points = await trackSubject(video.uri, {
        startSec: sourceTimeAt(video, state.playhead),
        durationSec: durationTimeline * video.speed,
        cx: point?.x ?? clip.position.x,
        cy: point?.y ?? clip.position.y,
        aspectW: ar,
        aspectH: 1,
      });
      if (!points) {
        Alert.alert(
          tr('panels.text.trackTitle'),
          tr('panels.text.trackFailed')
        );
        return;
      }
      const kf = pointsToPositionKeyframes(
        points,
        clip.position,
        state.playhead - clip.start,
        1 / video.speed
      );
      state.updateClip(clip.id, { keyframes: kf });
      setTrackStatus(null);
      Alert.alert(
        tr('panels.text.trackDoneTitle'),
        tr('panels.text.trackDoneIntro', {
          count: kf.x.length,
          seconds: (points[points.length - 1].t / video.speed).toFixed(1),
        }) +
          (kf.scale ? tr('panels.text.trackDoneScale') : '') +
          tr('panels.text.trackDoneOutro')
      );
    } finally {
      setTrackStatus(null);
    }
  };
  /** 🙂 arc-követés: az AI megkeresi az arcot a playhead kockáján, onnan indít */
  const trackFace = async () => {
    const state = useEditorStore.getState();
    if (!state.project || trackStatus) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(tr('panels.text.faceTrackTitle'), tr('panels.text.trackPlayheadOnVideo'));
      return;
    }
    setTrackStatus(tr('panels.text.faceSearchingStatus'));
    try {
      const ar = aspectValue(state.project.aspectRatio);
      const faces = await fetchFaces(video.uri, {
        atSec: sourceTimeAt(video, state.playhead),
        aspectW: ar,
        aspectH: 1,
      });
      const face = faces ? pickPrimaryFace(faces) : null;
      if (!face) {
        Alert.alert(
          tr('panels.text.faceTrackTitle'),
          faces === null
            ? tr('panels.text.faceDetectorUnavailable')
            : tr('panels.text.faceNotFound')
        );
        return;
      }
      await startTracking({ x: face.x, y: face.y });
    } finally {
      setTrackStatus(null);
    }
  };
  return { startTracking, trackFace };
}

export interface ShapeActionDeps {
  clip: TextClip;
  shapeBusy: boolean;
  setShapeBusy: (busy: boolean) => void;
  tr: TFunction;
}

/** 🔁 szöveg → forma */
export function createShapeActions({ clip, shapeBusy, setShapeBusy, tr }: ShapeActionDeps) {
  /**
   * 🔁 Text → Shape → Animation: a szöveget a teljes stílusával képpé sütjük
   * (worker), és forma-klipet (kép-kitöltés) hozunk létre belőle az overlay
   * sávon — a szöveg pozíció/skála kulcskockáit örökölve. Így a forma-eszköztár
   * (blend / glow / kontúr / lekerekítés / kulcskocka / objektum-követés) is
   * ráhúzható. A szövegklip megmarad (nem-destruktív).
   */
  const convertToShape = async () => {
    if (shapeBusy) {
      return;
    }
    setShapeBusy(true);
    const aspect = aspectValue(useEditorStore.getState().project?.aspectRatio ?? '9:16');
    const baked = await bakeTextToImage(clip, aspect);
    setShapeBusy(false);
    if (!baked) {
      Alert.alert(tr('panels.text.toShapeTitle'), tr('panels.text.toShapeFail'));
      return;
    }
    const { addClip, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    const w = clamp(baked.w / baked.canvasW, 0.05, 0.98);
    const h = clamp(baked.h / baked.canvasH, 0.02, 0.98);
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: clip.start,
        duration: clip.duration,
        shape: 'rectangle',
        position: { ...clip.position },
        w,
        h,
        fill: 'transparent',
        imageUri: baked.uri,
        // a szöveg pozíció/skála kulcskockái átöröklődnek → az animáció megmarad
        keyframes: clip.keyframes,
      },
      { id: makeId('ast'), kind: 'image', uri: baked.uri, provider: 'local', name: 'text-shape' }
    );
    selectClip(id);
  };
  return { convertToShape };
}
