import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { aspectValue, MIN_CLIP_DURATION } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { objectTrackWindow } from '@/lib/objectTrackWindow';
import { snap, type StepMode } from '@/lib/precisionPanelOps';
import { maxVideoDuration, sourceTimeAt } from '@/lib/projectUtils';
import { isRenderCancelledError, renderMp4 } from '@/lib/render';
import { clamp } from '@/lib/time';
import { pointsToPanKeyframes, trackSubject } from '@/lib/track';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import type { Clip } from '@/types/project';

/** a compound-proxy a gyökér foglaltság-állapotából él */
export interface CompoundProxyDeps {
  clip: Clip;
  t: TFunction;
  proxyBusy: boolean;
  setProxyBusy: (busy: boolean) => void;
  updateClip: EditorState['updateClip'];
}

export function createCompoundProxyAction({ clip, t, proxyBusy, setProxyBusy, updateClip }: CompoundProxyDeps) {
  /**
   * 🧱 Compound előnézet: a beágyazott kompozíciót MP4-proxyba rendereli
   * (local-first, ingyen; összetettnél felhő = Pro), és a klip uri-ját a proxyra
   * cseréli — így a compound a VALÓS tartalmát mutatja (a durva placeholder helyett).
   * Az export úgyis rekurzívan újrarendereli a comp-ot, ez csak az előnézeté.
   */
  const renderCompoundProxy = async () => {
    if (clip.kind !== 'video' || !clip.comp || proxyBusy) {
      return;
    }
    setProxyBusy(true);
    try {
      const comp = clip.comp;
      const sub = {
        id: `${clip.id}-comp`,
        name: 'comp',
        aspectRatio: comp.aspectRatio,
        tracks: comp.tracks,
        assets: comp.assets,
        createdAt: '',
        updatedAt: '',
        schemaVersion: 4,
      };
      const file = await renderMp4(sub, undefined, { resolution: 720, fps: 30, quality: 'medium', codec: 'h264' }, { mode: 'auto' });
      updateClip(clip.id, { uri: file.uri });
      Alert.alert(t('panels.precision.compoundDoneTitle'), t('panels.precision.compoundDoneBody'));
    } catch (err) {
      logCaught('components/editor/panels/PrecisionPanel.tsx:renderCompoundProxy', err);
      if (!isRenderCancelledError(err)) {
        Alert.alert(t('panels.precision.compoundTitle'), (err as Error).message);
      }
    } finally {
      setProxyBusy(false);
    }
  };
  return renderCompoundProxy;
}

/** a kép objektum-követése a gyökér foglaltság-állapotából és a store pick-céljából él */
export interface ImageTrackDeps {
  clip: Clip;
  t: TFunction;
  trackBusy: boolean;
  setTrackBusy: (busy: boolean) => void;
  setPickTarget: EditorState['setPickTarget'];
}

export function createImageTrackActions({ clip, t, trackBusy, setTrackBusy, setPickTarget }: ImageTrackDeps) {
  /**
   * 🎯 Objektum-követés: a felhasználó a vásznon rákoppint a követendő objektumra,
   * a worker (NCC-tracker) végigköveti a videón, és a KÉP a pásztázással utána
   * mozog (a kép a videó fölötti overlay/PiP; a videót követi). Pro (objectTrack).
   */
  const runTrackImage = (point: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || trackBusy || clip.kind !== 'image') {
      return;
    }
    const win = objectTrackWindow(project, clip, state.playhead);
    if (!win.ok) {
      if (win.reason === 'needVideo') {
        Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackNeedVideo'));
      } else if (win.reason === 'playheadOnClip') {
        Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackPlayheadOnClip'));
      } else {
        Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackTooShort'));
      }
      return;
    }
    const { video, durTl } = win;
    const base = { x: clip.transform?.x ?? 0, y: clip.transform?.y ?? 0 };
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
          Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackFailed'));
          return;
        }
        const kf = pointsToPanKeyframes(points, base, state.playhead - clip.start, 1 / video.speed);
        state.updateClip(clip.id, { keyframes: { ...clip.keyframes, ...kf } });
        Alert.alert(t('panels.precision.trackDone'), t('panels.precision.trackDoneBody', { count: kf.x.length }));
      })
      .catch((err: Error) => { logCaught('components/editor/panels/PrecisionPanel.tsx:runTrackImage', err); return Alert.alert(t('panels.precision.trackTitle'), err.message); })
      .finally(() => setTrackBusy(false));
  };
  const startTrackPick = () => {
    Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackPickHint'));
    setPickTarget((point) => runTrackImage(point));
  };
  return { runTrackImage, startTrackPick };
}

/** az időzítés-műveletek a gyökér lépés-módjából és a lejátszófejből élnek */
export interface TimingDeps {
  clip: Clip;
  updateClip: EditorState['updateClip'];
  setPlayhead: EditorState['setPlayhead'];
  playhead: number;
  stepMode: StepMode;
  fps: number;
  step: number;
}

export function createTimingActions({ clip, updateClip, setPlayhead, playhead, stepMode, fps, step }: TimingDeps) {
  const maxDuration =
    clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;

  const setStart = (start: number) => {
    updateClip(clip.id, { start: Math.max(0, snap(start, stepMode, fps)) });
  };

  const setDuration = (duration: number) => {
    updateClip(clip.id, {
      duration: snap(clamp(duration, MIN_CLIP_DURATION, maxDuration), stepMode, fps),
    });
  };

  /** a lejátszófej léptetése ugyanazzal a finomsággal */
  const nudgePlayhead = (dir: 1 | -1) => {
    setPlayhead(snap(playhead + dir * step, stepMode, fps));
  };

  const alignToPlayhead = () => {
    const { playhead } = useEditorStore.getState();
    setStart(playhead);
  };
  return { setStart, setDuration, nudgePlayhead, alignToPlayhead };
}
