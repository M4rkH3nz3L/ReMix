import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { aspectValue } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { objectTrackWindow } from '@/lib/objectTrackWindow';
import { sourceTimeAt } from '@/lib/projectUtils';
import { pointsToPositionKeyframes, trackSubject } from '@/lib/track';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** az objektum-követés a gyökér állapotából (foglaltság) és a store pick-céljából él */
export interface ShapeTrackDeps {
  clip: ShapeClip;
  t: TFunction;
  trackBusy: boolean;
  setTrackBusy: (busy: boolean) => void;
  setPickTarget: EditorState['setPickTarget'];
}

export function createShapeTrackActions({ clip, t, trackBusy, setTrackBusy, setPickTarget }: ShapeTrackDeps) {
  /**
   * 🎯 Objektum-követés: a vásznon rákoppintasz a követendő objektumra, a worker
   * (a videón) végigköveti, és a FORMA (vagy shape-alapú 3D-matrica) a
   * pozíció-kulcskockákkal utána mozog. Pro (objectTrack).
   */
  const runTrack = (point: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || trackBusy) {
      return;
    }
    const win = objectTrackWindow(project, clip, state.playhead);
    if (!win.ok) {
      if (win.reason === 'needVideo') {
        Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackNeedVideo'));
      } else if (win.reason === 'playheadOnClip') {
        Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackPlayheadOnClip'));
      } else {
        Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackTooShort'));
      }
      return;
    }
    const { video, durTl } = win;
    setTrackBusy(true);
    trackSubject(video.uri, {
      startSec: sourceTimeAt(video, state.playhead),
      durationSec: durTl * video.speed,
      cx: point.x,
      cy: point.y,
      aspectW: aspectValue(project.aspectRatio),
      aspectH: 1,
    })
      .then((points) => {
        if (!points) {
          Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackFailed'));
          return;
        }
        const kf = pointsToPositionKeyframes(points, clip.position, state.playhead - clip.start, 1 / video.speed);
        state.updateClip(clip.id, { keyframes: { ...clip.keyframes, ...kf } });
        Alert.alert(t('panels.shape.trackDone'), t('panels.shape.trackDoneBody', { count: kf.x.length }));
      })
      .catch((err: Error) => { logCaught('components/editor/panels/ShapePanel.tsx:runTrack', err); return Alert.alert(t('panels.shape.trackTitle'), err.message); })
      .finally(() => setTrackBusy(false));
  };
  const startTrackPick = () => {
    Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackPickHint'));
    setPickTarget((p) => runTrack(p));
  };
  return { runTrack, startTrackPick };
}
