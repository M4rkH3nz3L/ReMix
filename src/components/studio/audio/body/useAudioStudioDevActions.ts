import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { ChordPart } from '@/components/studio/audio/ChordSheet';
import { applySilenceReview } from '@/components/studio/audio/SilenceReview';
import { applySpeechCut, selectSpeechFillers } from '@/components/studio/audio/SpeechEditBar';
import { AUDIO_STUDIO_MODES, type AudioStudioMode, type TransportGroup } from '@/lib/audioStudioModes';
import { barsBeatsLabelT, beatGridForTiming, bpmAt, DEFAULT_BPM, nextBeatSecT, projectTiming, tempoMapStep, tempoMapWith, tempoMapWithout } from '@/lib/audioTransport';
import type { ChordProgressionId } from '@/lib/chords';
import { registerDevAction } from '@/lib/devActions';
import type { DrumAiTemp } from '@/lib/drumAi';
import type { MusicKey } from '@/lib/pitch';
import type { LibraryTrack } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { useMixAssist } from '@/store/mixAssistStore';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { useSpeechEdit } from '@/store/speechEditStore';

/**
 * 🧪 a füstteszt a gombok mögötti függvényeket hívja (csak __DEV__) — a törzs minden renderben frissíti, a
 * regisztráció egyszer történik (a ref mindig a legfrissebbet adja)
 */
export interface AudioStudioDevApi {
  fit: () => void;
  zoomIn: () => void;
  marker: () => void;
  addLane: () => void;
  mixer: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  meter: () => void;
  beatSplit: (every: 'bar' | 'beat') => number;
  silenceFind: () => Promise<number | null>;
  speechStart: () => Promise<number | null>;
  speechUpgrade: () => Promise<number | null>;
  syncSelected: () => Promise<unknown>;
  openDrums: () => void;
  editClip: () => void;
  closeDrums: () => void;
  assistant: () => void;
  pianoRoll: (open: boolean) => void;
  autoBpm: () => Promise<void>;
  // ⏸️➕ csend / ✂️↩️ összeillesztés
  insertSilence: (len: number, scope: 'track' | 'all') => number;
  join: () => number;
  // 🎙️ felvétel
  recordToggle: () => Promise<void>;
  recordPause: () => void;
  recordState: () => Record<string, unknown>;
  // 🎹🤖 hangszerek és AI
  placeLoop: (id: string) => Promise<string | null>;
  placeCloud: (track: LibraryTrack) => Promise<string | null>;
  placeChords: (arg: { key: MusicKey; prog: ChordProgressionId; parts: ChordPart[] }) => Promise<string[]>;
  stems: (id: string) => Promise<string[] | null>;
  aiDrums: (bars: number, temp?: DrumAiTemp, seed?: number) => Promise<string | null>;
  aiDenoiseMany: (ids: string[], strength?: number) => Promise<number>;
  aiDenoise: (id: string, strength: number) => Promise<{ vad: number; ms: number } | null>;
  resetAiDenoise: (id: string) => void;
  humMelody: (id: string, k: { root: number; minor: boolean }) => Promise<string | null>;
  applyTune: (id: string, s: { root: number; minor: boolean; strength: number; harmonySteps?: number }) => Promise<unknown>;
}

export const NOOP_DEV_API: AudioStudioDevApi = {
  fit: () => {},
  zoomIn: () => {},
  marker: () => {},
  addLane: () => {},
  mixer: () => {},
  copy: () => {},
  paste: () => {},
  duplicate: () => {},
  meter: () => {},
  beatSplit: () => 0,
  silenceFind: async () => null,
  speechStart: async () => null,
  speechUpgrade: async () => null,
  syncSelected: async () => null,
  openDrums: () => {},
  editClip: () => {},
  closeDrums: () => {},
  assistant: () => {},
  pianoRoll: () => {},
  autoBpm: async () => {},
  insertSilence: () => 0,
  join: () => 0,
  recordToggle: async () => {},
  recordPause: () => {},
  recordState: () => ({}),
  placeLoop: async () => null,
  placeCloud: async () => null,
  placeChords: async () => [],
  stems: async () => null,
  aiDrums: async () => null,
  aiDenoiseMany: async () => 0,
  aiDenoise: async () => null,
  resetAiDenoise: () => undefined,
  humMelody: async () => null,
  applyTune: async () => null,
};

type Setter = Dispatch<SetStateAction<boolean>>;

/** 🧪 A hang-stúdió füstteszt-műveletei (`registerDevAction`) — a törzsből kiemelve, változatlan kulcsokkal. */
export function useAudioStudioDevActions({
  workspace,
  api,
  layoutRef,
  scrollXRef,
  followRef,
  studioMode,
  layout,
  showMore,
  assistantOpen,
  chooseMode,
  setModePicker,
  setShowMore,
  setMastering,
  setMixerOpen,
  setTts,
  setSampler,
  setAdding,
  setLoopsOpen,
  setChordsOpen,
}: {
  workspace?: 'music';
  api: RefObject<AudioStudioDevApi>;
  layoutRef: RefObject<{ docked: boolean; workspaceTop: number | null; rootH: number }>;
  scrollXRef: RefObject<number>;
  followRef: RefObject<{ pps: number; viewW: number; contentW: number }>;
  studioMode: AudioStudioMode;
  layout: { front: TransportGroup[]; more: TransportGroup[] };
  showMore: boolean;
  assistantOpen: boolean;
  chooseMode: (m: AudioStudioMode) => void;
  setModePicker: Setter;
  setShowMore: Setter;
  setMastering: Setter;
  setMixerOpen: Setter;
  setTts: Setter;
  setSampler: Setter;
  setAdding: Setter;
  setLoopsOpen: Setter;
  setChordsOpen: Setter;
}): void {
  // 🧪 füstteszt: melyik munkaterület él
  useEffect(() => registerDevAction('audio.workspace', () => workspace ?? 'audio'), [workspace]);
  // 🧪 füstteszt (S13): tempóváltások a lejátszófejnél, a mérvadó BPM, a rács — a tárolóból, closure nélkül
  useEffect(() => {
    const offs = [
      registerDevAction('audio.tempoAdd', (arg) => {
        const st = useEditorStore.getState();
        if (!st.project) return false;
        return st.dispatch({ type: 'SET_TEMPO_MAP', tempoMap: tempoMapWith(st.project, st.playhead, Number(arg) || bpmAt(st.project, st.playhead)) }, 'user');
      }),
      registerDevAction('audio.tempoStep', (arg) => {
        const st = useEditorStore.getState();
        if (!st.project) return false;
        const dir = Number(arg) || 1;
        const stepped = tempoMapStep(st.project, st.playhead, dir);
        return stepped ? st.dispatch({ type: 'SET_TEMPO_MAP', tempoMap: stepped }, 'user') : st.dispatch({ type: 'SET_BPM', bpm: (st.project.bpm ?? DEFAULT_BPM) + dir }, 'user');
      }),
      registerDevAction('audio.tempoRemove', () => {
        const st = useEditorStore.getState();
        return st.project ? st.dispatch({ type: 'SET_TEMPO_MAP', tempoMap: tempoMapWithout(st.project, st.playhead) }, 'user') : false;
      }),
      registerDevAction('audio.layout', () => ({ docked: layoutRef.current.docked, workspaceTop: layoutRef.current.workspaceTop, rootH: layoutRef.current.rootH })),
      registerDevAction('audio.tempoMap', () => useEditorStore.getState().project?.tempoMap ?? []),
      registerDevAction('audio.nextBeat', () => {
        const st = useEditorStore.getState();
        if (!st.project) return false;
        st.setPlayhead(nextBeatSecT(projectTiming(st.project), st.playhead));
        return true;
      }),
      registerDevAction('audio.bpmAt', (arg) => {
        const st = useEditorStore.getState();
        return st.project ? bpmAt(st.project, Number(arg)) : null;
      }),
      registerDevAction('audio.gridLines', (arg) => {
        const st = useEditorStore.getState();
        const a = (arg as { from?: number; to?: number } | undefined) ?? {};
        return st.project ? beatGridForTiming(projectTiming(st.project), a.from ?? 0, a.to ?? 10, 100).map((g) => g.sec) : [];
      }),
      registerDevAction('audio.barsBeats', (arg) => {
        const st = useEditorStore.getState();
        return st.project ? barsBeatsLabelT(projectTiming(st.project), Number(arg)) : null;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [layoutRef]);
  // 🧪 füstteszt (V10): a mód és a transzport-sor elrendezése
  useEffect(() => {
    const offs = [
      registerDevAction('audio.studioMode', () => ({ mode: studioMode, front: layout.front, more: layout.more, showMore, assistantOpen })),
      registerDevAction('audio.setStudioMode', (arg) => {
        if (!AUDIO_STUDIO_MODES.includes(arg as AudioStudioMode)) return false;
        chooseMode(arg as AudioStudioMode);
        return true;
      }),
      registerDevAction('audio.toggleModePicker', () => {
        setModePicker((v) => !v);
        return true;
      }),
      registerDevAction('audio.toggleMore', () => {
        setShowMore((v) => !v);
        return true;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [studioMode, layout, showMore, assistantOpen, chooseMode, setModePicker, setShowMore]);
  // 🧪 füstteszt: felvétel indítása/leállítása, szünet/folytatás, a felvételi sáv állapota (csak __DEV__)
  useEffect(() => {
    const offs = [
      registerDevAction('audio.recordToggle', () => api.current.recordToggle()),
      registerDevAction('audio.recordPause', () => api.current.recordPause()),
      registerDevAction('audio.recordState', () => api.current.recordState()),
      registerDevAction('audio.master', () => setMastering(true)),
      // ♿ a11y-füstteszt (S8): a lapok nyitása/zárása sorban, hogy a héj a képernyőolvasó-címkéket kiolvashassa
      registerDevAction('audio.closeMaster', () => setMastering(false)),
      registerDevAction('audio.closeMixer', () => setMixerOpen(false)),
      registerDevAction('audio.closeTts', () => setTts(false)),
      registerDevAction('audio.openSampler', () => setSampler(true)),
      registerDevAction('audio.closeSampler', () => setSampler(false)),
      registerDevAction('audio.openAddMedia', () => setAdding(true)),
      registerDevAction('audio.closeAddMedia', () => setAdding(false)),
      registerDevAction('audio.insertSilence1Track', () => api.current.insertSilence(1, 'track')),
      registerDevAction('audio.insertSilence1All', () => api.current.insertSilence(1, 'all')),
      registerDevAction('audio.join', () => api.current.join()),
    ];
    return () => offs.forEach((off) => off());
  }, [api, setMastering, setMixerOpen, setTts, setSampler, setAdding]);
  // 🧪 a füstteszt a gombok mögötti függvényeket hívja (csak __DEV__)
  useEffect(() => {
    const offs = [
      registerDevAction('audio.fit', () => api.current.fit()),
      registerDevAction('audio.zoomIn', () => api.current.zoomIn()),
      registerDevAction('audio.marker', () => api.current.marker()),
      registerDevAction('audio.addLane', () => api.current.addLane()),
      registerDevAction('audio.mixer', () => api.current.mixer()),
      registerDevAction('audio.copy', () => api.current.copy()),
      registerDevAction('audio.paste', () => api.current.paste()),
      registerDevAction('audio.duplicate', () => api.current.duplicate()),
      registerDevAction('audio.meter', () => api.current.meter()),
      registerDevAction('audio.silenceFind', () => api.current.silenceFind()),
      registerDevAction('audio.silenceToggle1', () => useSilenceReview.getState().toggle(1)),
      registerDevAction('audio.silenceModeAll', () => useSilenceReview.getState().setMode('all')),
      registerDevAction('audio.silenceApply', () => applySilenceReview()),
      registerDevAction('audio.speechStart', () => api.current.speechStart()),
      registerDevAction('audio.speechFillers', () => selectSpeechFillers()),
      registerDevAction('audio.speechModeAll', () => useSpeechEdit.getState().setMode('all')),
      registerDevAction('audio.speechApply', () => applySpeechCut()),
      registerDevAction('audio.speechUpgrade', () => api.current.speechUpgrade()),
      registerDevAction('audio.syncSelected', () => api.current.syncSelected()),
      registerDevAction('audio.openDrums', () => api.current.openDrums()),
      registerDevAction('audio.loops', () => setLoopsOpen(true)),
      registerDevAction('loops.place', (id) => api.current.placeLoop(String(id))),
      registerDevAction('audio.chords', () => setChordsOpen(true)),
      registerDevAction('stems.onDevice', (arg) => api.current.stems(String(arg))),
      registerDevAction('ai.drumsAt', (arg) => {
        const a = arg as { bars: number; temp?: DrumAiTemp; seed?: number };
        return api.current.aiDrums(a.bars, a.temp, a.seed);
      }),
      registerDevAction('aiDenoise.many', (arg) => {
        const a = arg as { clipIds: string[]; strength?: number };
        return api.current.aiDenoiseMany(a.clipIds, a.strength);
      }),
      registerDevAction('audio.resetAiDenoise', (arg) => api.current.resetAiDenoise(String(arg))),
      registerDevAction('aiDenoise.apply', (arg) => {
        const a = arg as { clipId: string; strength: number };
        return api.current.aiDenoise(a.clipId, a.strength);
      }),
      registerDevAction('hum.melody', (arg) => {
        const a = arg as { clipId: string; root: number; minor: boolean };
        return api.current.humMelody(a.clipId, a);
      }),
      registerDevAction('tune.apply', (arg) => {
        const a = arg as { clipId: string; root: number; minor: boolean; strength: number; harmonySteps?: number };
        return api.current.applyTune(a.clipId, a);
      }),
      registerDevAction('chords.place', (arg) => api.current.placeChords(arg as { key: MusicKey; prog: ChordProgressionId; parts: ChordPart[] })),
      registerDevAction('loops.placeCloud', (track) => api.current.placeCloud(track as LibraryTrack)),
      registerDevAction('audio.editClip', () => api.current.editClip()),
      registerDevAction('audio.closeDrums', () => api.current.closeDrums()),
      registerDevAction('audio.autoBpm', () => api.current.autoBpm()),
      registerDevAction('audio.openTts', () => setTts(true)),
      registerDevAction('audio.openPianoRoll', () => api.current.pianoRoll(true)),
      registerDevAction('audio.closePianoRoll', () => api.current.pianoRoll(false)),
      registerDevAction('audio.assistant', () => api.current.assistant()),
      registerDevAction('audio.mixAssist', () => useMixAssist.getState().show('mix')),
      registerDevAction('audio.mixAssistClose', () => useMixAssist.getState().close()),
      registerDevAction('audio.beatSplitBars', () => api.current.beatSplit('bar')),
      registerDevAction('audio.beatSplitBeats', () => api.current.beatSplit('beat')),
      registerDevAction('audio.view', () => ({ scrollX: scrollXRef.current, ...followRef.current })),
    ];
    return () => offs.forEach((off) => off());
  }, [api, scrollXRef, followRef, setLoopsOpen, setChordsOpen, setTts]);
}
