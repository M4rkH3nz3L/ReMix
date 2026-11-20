import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { firstAudioClipWithUri, importedAudioClip } from '@/lib/audioStudioOps';
import { detectBeats } from '@/lib/beats';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { probeAudioDuration } from '@/lib/media';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, Project } from '@/types/project';

/**
 * 🎧 A törzs saját műveletei: kilépés (a futó felvétel klip lesz), tempó-felismerés, forrás beillesztése.
 * A szerkesztés a command buson / a store műveletein át; az értékek a hívó renderjéből jönnek.
 */
export function studioActions({
  t,
  project,
  playhead,
  grid,
  selClip,
  bpmBusy,
  setBpmBusy,
  setDetectedBeats,
  setSource,
  finishIfRecording,
  onExit,
}: {
  t: TFunction;
  project: Project;
  playhead: number;
  grid: number;
  selClip: AudioClip | null;
  bpmBusy: boolean;
  setBpmBusy: Dispatch<SetStateAction<boolean>>;
  setDetectedBeats: Dispatch<SetStateAction<{ uri: string; beats: number[] } | null>>;
  setSource: Dispatch<SetStateAction<boolean>>;
  finishIfRecording: () => Promise<unknown>;
  onExit: () => void;
}) {
  // kilépéskor a futó felvétel klip lesz, nem vész el
  const exitStudio = () => {
    void finishIfRecording()
      .catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:exitStudio', caught); })
      .then(onExit);
  };

  // 🥁🔎 tempó auto-felismerés: a kiválasztott (vagy az első hang-) klip beat-rácsából → BPM (a telefonon, offline; a worker tartalék)
  const autoDetectBpm = async () => {
    if (bpmBusy) {
      return;
    }
    const sourceClip = selClip ?? firstAudioClipWithUri(project) ?? null;
    const uri = sourceClip?.uri ?? null;
    if (!uri) {
      Alert.alert(t('studio.audio.autoBpm', { defaultValue: 'Tempó felismerése' }), t('studio.audio.autoBpmNoClip', { defaultValue: 'Nincs hang-klip az elemzéshez.' }));
      return;
    }
    setBpmBusy(true);
    try {
      const grid = await detectBeats(uri);
      if (grid && grid.bpm > 0) {
        useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: Math.round(grid.bpm) });
        // 🥁📍 a felismert beatek a forrás idejében maradnak, a vonalak a klipekből számolódnak
        setDetectedBeats({ uri, beats: grid.beats ?? [] });
      } else {
        Alert.alert(t('studio.audio.autoBpm', { defaultValue: 'Tempó felismerése' }), t('studio.audio.autoBpmFail', { defaultValue: 'Nem sikerült felismerni a tempót.' }));
      }
    } finally {
      setBpmBusy(false);
    }
  };

  // 🗂️ forrás-mappából a sávra: a HANG-forrás klipként a 'music' sávon, a playheadnél
  const insertSource = async (asset: Asset) => {
    if (asset.kind !== 'audio') {
      return;
    }
    const dur = asset.duration || (await probeAudioDuration(asset.uri));
    if (!dur) {
      Alert.alert(t('studio.audio.intake.unreadableTitle'), t('studio.audio.intake.unknownDuration'));
      return;
    }
    const clip = importedAudioClip({ id: makeId('clip'), start: snapToFrame(playhead, grid), duration: dur, uri: asset.uri, label: asset.name ?? t('studio.kind.audio') });
    useEditorStore.getState().addClip('music', clip, asset);
    setSource(false);
  };

  return { exitStudio, autoDetectBpm, insertSource };
}
