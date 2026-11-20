import type { TFunction } from 'i18next';

import { selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { startSpeechEdit, upgradeSpeechModel } from '@/components/studio/audio/SpeechEditBar';
import { runAudioSync, syncCandidates } from '@/components/studio/audio/audioSyncAction';
import { nextMeter, type Meter } from '@/lib/audioTransport';
import { useEditorStore } from '@/store/editorStore';

import type { clipAiActions } from './clipAiActions';
import type { audioEditActions } from './editActions';
import type { AudioStudioDevApi } from './useAudioStudioDevActions';
import type { useInstrumentStudio } from './useInstrumentStudio';
import type { useStudioRecording } from './useStudioRecording';

/**
 * 🧪 a füstteszt-API (csak __DEV__ hívja): a gombok mögötti függvények a törzs aktuális renderjéből —
 * a törzs minden renderben ezzel frissíti a `devApi` refet
 */
export function studioDevApi({
  t,
  grid,
  meter,
  fitToView,
  zoomStep,
  edit,
  ai,
  inst,
  rec,
  autoDetectBpm,
  setMixerOpen,
  setEditing,
  setAssistantOpen,
}: {
  t: TFunction;
  grid: number;
  meter: Meter;
  fitToView: () => void;
  zoomStep: (dir: 1 | -1) => void;
  edit: ReturnType<typeof audioEditActions>;
  ai: ReturnType<typeof clipAiActions>;
  inst: ReturnType<typeof useInstrumentStudio>;
  rec: ReturnType<typeof useStudioRecording>;
  autoDetectBpm: () => Promise<void>;
  setMixerOpen: (v: boolean) => void;
  setEditing: (v: boolean) => void;
  setAssistantOpen: (v: boolean) => void;
}): AudioStudioDevApi {
  return {
    fit: fitToView,
    zoomIn: () => zoomStep(1),
    marker: edit.markerAtPlayhead,
    addLane: edit.addLane,
    mixer: () => setMixerOpen(true),
    copy: edit.copySelection,
    paste: edit.pasteAtPlayhead,
    duplicate: edit.duplicateSelection,
    meter: () => useEditorStore.getState().dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: nextMeter(meter) }),
    beatSplit: edit.beatSplitSelection,
    silenceFind: async () => {
      const st = useEditorStore.getState();
      const c = selectedAudioClip(st.project, st.selectedClipId);
      const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === c?.id));
      return c && tr ? startSilenceSearch(c, tr.type, grid, t) : null;
    },
    speechStart: async () => {
      const st = useEditorStore.getState();
      const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === st.selectedClipId));
      return tr ? startSpeechEdit(tr.type, t) : null;
    },
    speechUpgrade: () => upgradeSpeechModel(t, false),
    syncSelected: async () => {
      const st = useEditorStore.getState();
      const c = selectedAudioClip(st.project, st.selectedClipId);
      const ref = c ? syncCandidates(c)[0] : undefined;
      return c && ref ? runAudioSync(c, ref, grid, t, true) : null;
    },
    openDrums: () => inst.setDrumMachine(true),
    editClip: () => setEditing(true),
    closeDrums: () => inst.setDrumMachine(false),
    assistant: () => setAssistantOpen(true),
    pianoRoll: (open) => inst.setPianoRoll(open),
    autoBpm: autoDetectBpm,
    insertSilence: edit.insertSilenceAt,
    join: edit.joinSelected,
    recordToggle: rec.toggleRecord,
    recordPause: rec.pauseResumeRecording,
    recordState: rec.recordState,
    placeLoop: inst.placeLoopById,
    placeCloud: inst.placeCloudTrack,
    placeChords: (arg) => inst.placeChords(arg.key, arg.prog, arg.parts),
    stems: ai.stemsOnDevice,
    aiDrums: ai.aiDrumsAt,
    aiDenoiseMany: ai.aiDenoiseClips,
    aiDenoise: ai.applyAiDenoise,
    resetAiDenoise: ai.resetAiDenoise,
    humMelody: ai.humMelody,
    applyTune: ai.applyTune,
  };
}
