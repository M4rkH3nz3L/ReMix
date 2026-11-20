import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { firstMusicClip, videoUris } from '@/lib/assistantPanelOps';
import { buildBeatFlashPlan, buildBeatPulsePlan } from '@/lib/beatFx';
import { buildBeatSplitPlan, detectBeats, timelineBeats } from '@/lib/beats';
import { buildCutPlan, buildSceneSplitPlan, detectScenes, detectSilence } from '@/lib/cutlist';
import type { SilenceRange } from '@/lib/cutlist';
import { makeId } from '@/lib/id';
import { buildMultiRangeDeletePlan } from '@/lib/rangeEdit';
import { renderServerUrl } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';

/**
 * ✂️ A determinisztikus vágó-eszközök (holtidő, jelenet, ütem, beat-effekt):
 * worker-elemzés → terv → jóváhagyás után EGY undo-lépés a command buson (actor: 'ai').
 */
export function useCutTools(t: TFunction, setApplied: (message: string | null) => void) {
  const [cutStatus, setCutStatus] = useState<string | null>(null);

  /**
   * Holtidő-vágás (Editor AI cut-lista): determinisztikus FFmpeg-elemzés a
   * workeren — AI-kulcs nélkül is működik. A terv jóváhagyás után egyetlen
   * undo-lépésként fut le.
   */
  const cutDeadAir = async () => {
    const state = useEditorStore.getState();
    if (!state.project || cutStatus) {
      return;
    }
    setCutStatus(t('panels.assistant.silenceAnalysis'));
    try {
      const uris = videoUris(state.project);
      if (uris.length === 0) {
        Alert.alert(t('panels.assistant.deadAirTitle'), t('panels.assistant.noVideoClip'));
        return;
      }
      const silencesByUri = new Map<string, SilenceRange[]>();
      for (let i = 0; i < uris.length; i++) {
        setCutStatus(t('panels.assistant.silenceAnalysisProgress', { current: i + 1, total: uris.length }));
        const silences = await detectSilence(uris[i]);
        if (silences) {
          silencesByUri.set(uris[i], silences);
        }
      }
      if (silencesByUri.size === 0) {
        Alert.alert(
          t('panels.assistant.deadAirTitle'),
          Platform.OS === 'web'
            ? t('panels.assistant.silenceWebUnavailable')
            : t('panels.assistant.silenceUnavailable', { url: `${renderServerUrl()}/silence` })
        );
        return;
      }
      const plan = buildCutPlan(state.project, silencesByUri);
      if (!plan) {
        Alert.alert(t('panels.assistant.deadAirTitle'), t('panels.assistant.noDeadAir'));
        return;
      }
      Alert.alert(
        t('panels.assistant.deadAirRemoveTitle'),
        t('panels.assistant.deadAirBody', {
          cuts: plan.cuts,
          seconds: plan.removedSeconds.toFixed(1),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.applyAction'),
            onPress: () => {
              // B16: MINDEN sáv ripple-ödik a kivágott szakaszokkal (felirat, szöveg, PiP, hang) —
              // a háttérzene folyamatos marad, csak tolódik; zárolt sáv érintetlen
              const st = useEditorStore.getState();
              const patches = st.project
                ? buildMultiRangeDeletePlan(st.project, plan.removedRanges, st.lockedTracks)
                : null;
              const ok = patches
                ? st.dispatch({ type: 'REPLACE_TRACKS', tracks: patches, label: t('panels.assistant.deadAirRemoveTitle') }, 'ai')
                : st.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips }, 'ai');
              setApplied(
                ok
                  ? t('panels.assistant.deadAirDone', {
                      cuts: plan.cuts,
                      seconds: plan.removedSeconds.toFixed(1),
                    })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setCutStatus(null);
    }
  };

  const [sceneStatus, setSceneStatus] = useState<string | null>(null);

  /**
   * Jelenetvágás: FFmpeg scene-detektálás a workeren → a klipek felvágása a
   * jelenetváltásoknál (elrendezés változatlan, csak vágások kerülnek be).
   * Utána a darabok egyenként törölhetők/rendezhetők.
   */
  const splitAtScenes = async () => {
    const state = useEditorStore.getState();
    if (!state.project || sceneStatus) {
      return;
    }
    setSceneStatus(t('panels.assistant.sceneAnalysis'));
    try {
      const uris = videoUris(state.project);
      if (uris.length === 0) {
        Alert.alert(t('panels.assistant.sceneCutTitle'), t('panels.assistant.noVideoClip'));
        return;
      }
      const scenesByUri = new Map<string, number[]>();
      for (let i = 0; i < uris.length; i++) {
        setSceneStatus(t('panels.assistant.sceneAnalysisProgress', { current: i + 1, total: uris.length }));
        const scenes = await detectScenes(uris[i]);
        if (scenes) {
          scenesByUri.set(uris[i], scenes);
        }
      }
      if (scenesByUri.size === 0) {
        Alert.alert(
          t('panels.assistant.sceneCutTitle'),
          t('panels.assistant.sceneAnalysisUnavailable')
        );
        return;
      }
      const plan = buildSceneSplitPlan(state.project, scenesByUri);
      if (!plan) {
        Alert.alert(t('panels.assistant.sceneCutTitle'), t('panels.assistant.noSceneChange'));
        return;
      }
      Alert.alert(
        t('panels.assistant.sceneCutHeader'),
        t('panels.assistant.sceneCutBody', { count: plan.splits }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.splitAction'),
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? t('panels.assistant.sceneCutDone', { count: plan.splits })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setSceneStatus(null);
    }
  };

  const [beatStatus, setBeatStatus] = useState<string | null>(null);
  const [fxStatus, setFxStatus] = useState<string | null>(null);

  const applyBeatFx = async (kind: 'pulse' | 'flash') => {
    const state = useEditorStore.getState();
    if (!state.project || fxStatus) {
      return;
    }
    setFxStatus(t('panels.assistant.beatAnalysis'));
    try {
      const musicClip = firstMusicClip(state.project);
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert(t('panels.assistant.beatFxTitle'), t('panels.assistant.addMusicFirst'));
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid || grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert(t('panels.assistant.beatFxTitle'), t('panels.assistant.noBeatGrid'));
        return;
      }
      if (kind === 'pulse') {
        // gyors zenénél downbeatenként pulzál, különben minden beatre
        const useDownbeats = grid.bpm > 110;
        const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
        const plan = buildBeatPulsePlan(state.project, times);
        if (!plan) {
          Alert.alert(
            t('panels.assistant.beatPulseTitle'),
            t('panels.assistant.beatPulseNoClip')
          );
          return;
        }
        Alert.alert(
          t('panels.assistant.beatPulseTitle'),
          t('panels.assistant.beatPulseBody', { pulses: plan.pulses, bpm: grid.bpm }) +
            (plan.skipped > 0
              ? t('panels.assistant.beatPulseSkipped', { count: plan.skipped })
              : '') +
            t('panels.assistant.beatPulseUndo'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('panels.assistant.applyAction'),
              onPress: () => {
                const ok = useEditorStore
                  .getState()
                  .dispatch(
                    { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                    'ai'
                  );
                setApplied(
                  ok
                    ? t('panels.assistant.beatPulseDone', { count: plan.pulses })
                    : t('panels.assistant.failedShort')
                );
              },
            },
          ]
        );
      } else {
        const times = timelineBeats(musicClip, grid.downbeats);
        const plan = buildBeatFlashPlan(state.project, times, () => makeId('clip'));
        if (!plan) {
          Alert.alert(t('panels.assistant.beatFlashTitle'), t('panels.assistant.beatFlashNoDownbeat'));
          return;
        }
        Alert.alert(
          t('panels.assistant.beatFlashTitle'),
          t('panels.assistant.beatFlashBody', { flashes: plan.flashes, bpm: grid.bpm }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('panels.assistant.applyAction'),
              onPress: () => {
                const ok = useEditorStore
                  .getState()
                  .dispatch(
                    { type: 'REPLACE_TRACK_CLIPS', trackType: 'overlay', clips: plan.clips },
                    'ai'
                  );
                setApplied(
                  ok
                    ? t('panels.assistant.beatFlashDone', { count: plan.flashes })
                    : t('panels.assistant.failedShort')
                );
              },
            },
          ]
        );
      }
    } finally {
      setFxStatus(null);
    }
  };

  /**
   * Auto Beat Edit (P0‑2): a zenesáv első klipjének beat-rácsa a workertől →
   * a videóklipek felvágása az ütemeken (gyors tempónál a downbeat-eken).
   * Nem ripple; egy undo-lépés.
   */
  const splitOnBeats = async () => {
    const state = useEditorStore.getState();
    if (!state.project || beatStatus) {
      return;
    }
    setBeatStatus(t('panels.assistant.beatAnalysis'));
    try {
      const musicClip = firstMusicClip(state.project);
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.addMusicFirst'));
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid) {
        Alert.alert(
          t('panels.assistant.beatCutTitle'),
          t('panels.assistant.beatAnalysisUnavailable')
        );
        return;
      }
      if (grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.noBeatInMusic'));
        return;
      }
      // 135 BPM felett a minden-beat vágás már villódzás — ott a downbeat vág
      const useDownbeats = grid.bpm > 135;
      const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
      const plan = buildBeatSplitPlan(state.project, times);
      if (!plan) {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.noBeatInsideClips'));
        return;
      }
      Alert.alert(
        t('panels.assistant.beatCutHeader'),
        t('panels.assistant.beatCutBody', {
          bpm: grid.bpm,
          downbeatNote: useDownbeats ? t('panels.assistant.beatCutDownbeatNote') : '',
          splits: plan.splits,
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.splitAction'),
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? t('panels.assistant.beatCutDone', { splits: plan.splits, bpm: grid.bpm })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setBeatStatus(null);
    }
  };

  return {
    cutStatus,
    cutDeadAir,
    sceneStatus,
    splitAtScenes,
    beatStatus,
    fxStatus,
    applyBeatFx,
    splitOnBeats,
  };
}
