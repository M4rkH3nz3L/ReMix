import type { TFunction } from 'i18next';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { CHORD_PARTS, type ChordPart } from '@/components/studio/audio/ChordSheet';
import type { DrumSource } from '@/components/studio/audio/DrumMachineSheet';
import { CHORD_PART_VOLUME, CHORD_PART_WAVE, clipIdSet, importedAudioClip, pickChordLane } from '@/lib/audioStudioOps';
import { DEFAULT_BPM } from '@/lib/audioTransport';
import { chordParts, PROGRESSIONS, type ChordProgressionId } from '@/lib/chords';
import type { EditorCommand } from '@/lib/commands';
import { patternHits, type DrumHit } from '@/lib/drums';
import { renderDrumsToClip } from '@/lib/drumsClient';
import { editGridRate, snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { samplerNotesOnDevice, samplerPadsOnDevice } from '@/lib/instrumentClient';
import { bakeNewCommands, clipsOfDoc, drumsDoc, instrumentDocOf, rebakeCommands, samplerDoc, synthDoc } from '@/lib/instrumentDoc';
import { BUILTIN_LOOPS, LOOP_BARS, LOOP_CATEGORIES, loopDrums, loopNotes, type BuiltinLoop } from '@/lib/loopLibrary';
import type { MusicKey } from '@/lib/pitch';
import { downloadTrack, type LibraryTrack } from '@/lib/render';
import type { SamplerPattern } from '@/lib/sampler';
import { renderSamplerToClip } from '@/lib/samplerClient';
import { DEFAULT_ROOT_MIDI } from '@/lib/samplerPlus';
import { packLoopsIn } from '@/lib/soundPack';
import type { SynthNote, SynthWave } from '@/lib/synth';
import { renderSynthToClip } from '@/lib/synthClient';
import { tempoMatchPatch } from '@/lib/tempoMatch';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { useSoundPacks } from '@/store/soundPackStore';
import type { Asset, AudioClip, InstrumentDoc, Project, TrackType } from '@/types/project';

export type PlaceInstrument = (
  doc: InstrumentDoc,
  res: { uri: string; durationSec: number },
  label: string,
  at?: { start: number; trackType: TrackType; newTrackName?: string }
) => void;

/** 🎛️ V2.3: a sampler Dallam módja (a piano roll a minta hangjával) */
export type SamplerMelody = { sampleUri: string; sampleName: string; rootMidi: number };

/**
 * 🎹🥁🎛️ A hang-stúdió hangszerei: piano roll, dob-gép, sampler (pad / step / dallam), beépített és felhős loopok
 * (V2), akkordmenet (V3.1). A lapok nyitott-állapota, a foglaltság és a sütés (a telefonon) → szerkeszthető minta
 * (`InstrumentDoc`) + klip, mind egy kötegben (egy undo) a command buson. A `project` a hívó renderjéből jön.
 */
export function useInstrumentStudio({ t, project, setEditing }: { t: TFunction; project: Project | null; setEditing: (v: boolean) => void }) {
  const [pianoRoll, setPianoRoll] = useState(false);
  /** 🎹🥁 az újraszerkesztett hangszer-minta (null = új minta) */
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [pianoBusy, setPianoBusy] = useState(false);
  const [drumMachine, setDrumMachine] = useState(false);
  const [drumBusy, setDrumBusy] = useState(false);
  const [sampler, setSampler] = useState(false);
  const [samplerBusy, setSamplerBusy] = useState(false);
  // 🔁 V2: beépített loopok (a lap, és a most sütött loop azonosítója)
  const [loopsOpen, setLoopsOpen] = useState(false);
  // 🎼 V3.1: akkordmenet-lap
  const [chordsOpen, setChordsOpen] = useState(false);
  const [chordBusy, setChordBusy] = useState(false);
  const chordBusyRef = useRef(false);
  // 🎛️ V2.3: a sampler Dallam módja (a piano roll a minta hangjával)
  const [samplerMelody, setSamplerMelody] = useState<SamplerMelody | null>(null);
  const [loopBusy, setLoopBusy] = useState<string | null>(null);
  // a foglaltság ref-ben is (az állapot csak a felületnek — két gyors hívás a render előtt is lássa)
  const loopBusyRef = useRef(false);

  const grid = editGridRate(project);
  const bpm = project?.bpm ?? DEFAULT_BPM;

  /**
   * 🎹🥁 a sütött minta a sávra: új minta → a minta (`InstrumentDoc`) + egy új klip a playheadnél;
   * újraszerkesztés → a minta + minden rá hivatkozó klip új hangja. Mindkettő egy kötegben (egy undo).
   */
  const placeInstrument: PlaceInstrument = (doc, res, label, at) => {
    const store = useEditorStore.getState();
    const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: label, duration: res.durationSec };
    const cur = store.project;
    if (cur && clipsOfDoc(cur, doc.id).length > 0) {
      store.applyBatch(rebakeCommands(cur, doc, res, asset), 'user');
      return;
    }
    // a hívás pillanatának lejátszófeje (a sütés aszinkron — a render-kori érték addigra elavulhat)
    const clip = importedAudioClip({ id: makeId('clip'), start: snapToFrame(at?.start ?? store.playhead, grid), duration: res.durationSec, uri: res.uri, label });
    // a hiányzó sávot ugyanaz a köteg hozza létre (egy undo)
    const addTrack: EditorCommand[] = at?.newTrackName ? [{ type: 'ADD_TRACK', track: { id: makeId('trk'), type: at.trackType, name: at.newTrackName, clips: [] } }] : [];
    if (store.applyBatch([...addTrack, ...bakeNewCommands(doc, at?.trackType ?? 'music', clip, asset)], 'user') > 0) {
      store.selectClip(clip.id);
    }
  };

  // 🎹 a piano-roll hangjegyei → a telefonon sütött hang-klip (a minta a projektben marad, szerkeszthető)
  const bakeSynth = async (notes: SynthNote[], wave: SynthWave, bars: number) => {
    if (pianoBusy) {
      return;
    }
    setPianoBusy(true);
    try {
      const res = await renderSynthToClip(notes, { bpm, wave });
      if (!res) {
        Alert.alert(t('studio.pianoRoll.title', { defaultValue: 'Zeneszerzés' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      placeInstrument(synthDoc(editDocId ?? makeId('inst'), bpm, bars, wave, notes), res, t('studio.pianoRoll.clipLabel', { defaultValue: 'Zene' }));
      setPianoRoll(false);
      setEditDocId(null);
    } finally {
      setPianoBusy(false);
    }
  };

  /** a klipszerkesztő „Minta szerkesztése”: a minta szerinti hangszer-lap nyílik a mentett tartalommal */
  const editInstrument = (docId: string) => {
    const doc = instrumentDocOf(useEditorStore.getState().project, docId);
    if (!doc) return;
    setEditing(false);
    setEditDocId(doc.id);
    if (doc.kind === 'drums') setDrumMachine(true);
    else if (doc.kind === 'sampler' && doc.sampler?.notes) setSamplerMelody({ sampleUri: doc.sampler.sampleUri, sampleName: doc.sampler.sampleName ?? '', rootMidi: doc.sampler.rootMidi ?? DEFAULT_ROOT_MIDI });
    else if (doc.kind === 'sampler') setSampler(true);
    else setPianoRoll(true);
  };

  // 🥁 a dob-minta ütései → a telefonon sütött hang-klip (a minta a projektben marad, szerkeszthető)
  const bakeDrums = async (hits: DrumHit[], bars: number, src: DrumSource) => {
    if (drumBusy) {
      return;
    }
    setDrumBusy(true);
    try {
      const res = await renderDrumsToClip(hits, { bpm, bars });
      if (!res) {
        Alert.alert(t('studio.drums.title', { defaultValue: 'Dob-gép' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      placeInstrument(drumsDoc(editDocId ?? makeId('inst'), bpm, bars, src.pattern, src.velocity, src.swing), res, t('studio.drums.clipLabel', { defaultValue: 'Dob' }));
      setDrumMachine(false);
      setEditDocId(null);
    } finally {
      setDrumBusy(false);
    }
  };

  /** 🎛️ V2.3 Pad mód: a szeletek a 4 pad lépésein → klip + szerkeszthető minta (egy undo) */
  const bakeSamplerPads = async (sampleUri: string, slices: number[], pads: boolean[][], bars: number, sampleName?: string) => {
    if (samplerBusy) return;
    setSamplerBusy(true);
    try {
      const res = await samplerPadsOnDevice(sampleUri, slices, pads, bars, bpm);
      if (!res) {
        Alert.alert(t('studio.sampler.title', { defaultValue: 'Sampler' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült.' }));
        return;
      }
      placeInstrument(samplerDoc(editDocId ?? makeId('inst'), bpm, bars, sampleUri, [], sampleName, { slices, pads }), res, t('studio.sampler.clipLabel', { defaultValue: 'Sampler' }));
      setSampler(false);
      setEditDocId(null);
    } finally {
      setSamplerBusy(false);
    }
  };

  /** 🎛️ V2.3 Dallam mód: a piano roll hangjegyei a minta hangjával (kromatikusan) → klip + minta (egy undo) */
  const bakeSamplerMelody = async (notes: SynthNote[], bars: number) => {
    const ctx = samplerMelody;
    if (!ctx || samplerBusy) return;
    setSamplerBusy(true);
    try {
      const res = await samplerNotesOnDevice(ctx.sampleUri, notes, ctx.rootMidi, bpm);
      if (!res) {
        Alert.alert(t('studio.sampler.title', { defaultValue: 'Sampler' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült.' }));
        return;
      }
      placeInstrument(samplerDoc(editDocId ?? makeId('inst'), bpm, bars, ctx.sampleUri, [], ctx.sampleName, { rootMidi: ctx.rootMidi, notes }), res, t('studio.sampler.clipLabel', { defaultValue: 'Sampler' }));
      setSamplerMelody(null);
      setEditDocId(null);
    } finally {
      setSamplerBusy(false);
    }
  };

  /**
   * 🔁 V2: egy beépített loop a lejátszófejnél — a telefon a projekt tempóján süti ki (a dob-géppel vagy a
   * szintivel), a minta szerkeszthető hangszer-dokumentum lesz (egy undo). Visszaadja az új klip azonosítóját.
   */
  const placeLoop = async (loop: BuiltinLoop): Promise<string | null> => {
    if (loopBusyRef.current) return null;
    loopBusyRef.current = true;
    setLoopBusy(loop.id);
    try {
      const label = loop.name ?? t(`studio.audio.loops.name.${loop.id}`);
      const before = clipIdSet(useEditorStore.getState().project);
      if (loop.def.kind === 'drums') {
        const src = loopDrums(loop.def);
        const res = await renderDrumsToClip(patternHits(src.pattern, src.velocity, src.swing), { bpm, bars: LOOP_BARS });
        if (!res) return null;
        placeInstrument(drumsDoc(makeId('inst'), bpm, LOOP_BARS, src.pattern, src.velocity, src.swing), res, label);
      } else {
        const res = await renderSynthToClip(loopNotes(loop.def), { bpm, wave: loop.def.wave });
        if (!res) return null;
        placeInstrument(synthDoc(makeId('inst'), bpm, LOOP_BARS, loop.def.wave, loopNotes(loop.def)), res, label);
      }
      const added = useEditorStore.getState().project?.tracks.flatMap((tr) => tr.clips).find((c) => !before.has(c.id));
      setLoopsOpen(false);
      return added?.id ?? null;
    } finally {
      loopBusyRef.current = false;
      setLoopBusy(null);
    }
  };

  /** 🧪 egy loop azonosító szerint — 🛍️ V4: a megvett hangcsomagok loopjai is (`pack_<tétel>_<loop>`) */
  const placeLoopById = async (id: string) => {
    const packLoops = useSoundPacks.getState().packs.flatMap(({ itemId, pack }) => LOOP_CATEGORIES.flatMap((c) => packLoopsIn(itemId, pack, c)));
    const loop = BUILTIN_LOOPS.find((l) => l.id === id) ?? packLoops.find((l) => l.id === id);
    return loop ? placeLoop(loop) : null;
  };

  /**
   * 🔁 V2.2: a szerveres teljes könyvtár zenéje (Pro — Free-ben a Pro-ajánlat nyílik) a lejátszófejnél; ismert
   * forrás-tempónál a projekt tempójára nyújtva (`tempoMatchPatch`, hangmagasság-tartással). Egy undo.
   */
  const placeCloudTrack = async (track: LibraryTrack): Promise<string | null> => {
    if (loopBusyRef.current) return null;
    loopBusyRef.current = true;
    setLoopBusy(track.id);
    try {
      const id = await guardPro(
        async () => {
          const uri = await downloadTrack(track);
          const st = useEditorStore.getState();
          const base = importedAudioClip({ id: makeId('clip'), start: snapToFrame(st.playhead, grid), duration: track.duration, uri, label: track.name });
          const clip: AudioClip = { ...base, ...(track.bpm ? (tempoMatchPatch(base, track.bpm, bpm) ?? {}) : {}) };
          const asset: Asset = { id: makeId('ast'), kind: 'audio', uri, provider: 'library', name: track.name, duration: track.duration };
          st.dispatch({ type: 'ADD_CLIP', trackType: 'music', clip, asset }, 'user');
          setLoopsOpen(false);
          return clip.id;
        },
        (err) => Alert.alert(t('studio.audio.loops.title'), err.message)
      );
      return id ?? null;
    } finally {
      loopBusyRef.current = false;
      setLoopBusy(null);
    }
  };

  /**
   * 🎼 V3.1: akkordmenet → a kiválasztott részek (akkordok, basszus, arpeggio, dob) a telefonon sütve, a
   * lejátszófejnél, külön sávokra (a hiányzó sávokat a köteg hozza létre) — mind szerkeszthető minta, EGY undo.
   * Visszaadja az új klipek azonosítóit.
   */
  const placeChords = async (key: MusicKey, prog: ChordProgressionId, parts: ChordPart[]): Promise<string[]> => {
    if (chordBusyRef.current || parts.length === 0) return [];
    chordBusyRef.current = true;
    setChordBusy(true);
    try {
      const cp = chordParts(key, PROGRESSIONS[prog]);
      const names = cp.labels.map((l) => l.name).join('–');
      const st0 = useEditorStore.getState();
      const at = snapToFrame(st0.playhead, grid);
      const commands: EditorCommand[] = [];
      const ids: string[] = [];
      const lanes: TrackType[] = (st0.project?.tracks ?? []).map((tr) => tr.type);
      for (const part of CHORD_PARTS.filter((p) => parts.includes(p))) {
        const res =
          part === 'drums'
            ? await renderDrumsToClip(patternHits(cp.drums.pattern, cp.drums.velocity, cp.drums.swing), { bpm, bars: cp.bars })
            : await renderSynthToClip(cp[part], { bpm, wave: CHORD_PART_WAVE[part] });
        if (!res) continue;
        const lane = pickChordLane(part, st0.project, lanes, commands, (type) => ({ type: 'ADD_TRACK', track: { id: makeId('trk'), type, name: t(`studio.audio.chords.part.${part}`), clips: [] } }));
        if (!lane) continue;
        const doc =
          part === 'drums'
            ? drumsDoc(makeId('inst'), bpm, cp.bars, cp.drums.pattern, cp.drums.velocity, cp.drums.swing)
            : synthDoc(makeId('inst'), bpm, cp.bars, CHORD_PART_WAVE[part], cp[part]);
        const label = t('studio.audio.chords.clip', { part: t(`studio.audio.chords.part.${part}`), chords: names });
        const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: label, duration: res.durationSec };
        const clip = importedAudioClip({ id: makeId('clip'), start: at, duration: res.durationSec, uri: res.uri, label, volume: CHORD_PART_VOLUME[part] });
        commands.push(...bakeNewCommands(doc, lane, clip, asset));
        ids.push(clip.id);
      }
      if (commands.length > 0) useEditorStore.getState().applyBatch(commands, 'user');
      setChordsOpen(false);
      return ids;
    } finally {
      chordBusyRef.current = false;
      setChordBusy(false);
    }
  };

  // 🎛️🔊 a sampler step-mintája (saját minta a rácson) → a telefonon sütött klip a playheadnél;
  // 🎛️ S1: a minta (a fájl + a rács) a projektben marad, a klip újraszerkeszthető és újrasüthető
  const bakeSampler = async (sampleUri: string, pattern: SamplerPattern, bars: number, sampleName?: string) => {
    if (samplerBusy) {
      return;
    }
    setSamplerBusy(true);
    try {
      const res = await renderSamplerToClip(sampleUri, pattern, { bpm, bars });
      if (!res) {
        Alert.alert(t('studio.sampler.title', { defaultValue: 'Sampler' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      placeInstrument(samplerDoc(editDocId ?? makeId('inst'), bpm, bars, sampleUri, pattern, sampleName), res, t('studio.sampler.clipLabel', { defaultValue: 'Sampler' }));
      setSampler(false);
      setEditDocId(null);
    } finally {
      setSamplerBusy(false);
    }
  };

  return {
    pianoRoll,
    setPianoRoll,
    editDocId,
    setEditDocId,
    pianoBusy,
    drumMachine,
    setDrumMachine,
    drumBusy,
    sampler,
    setSampler,
    samplerBusy,
    loopsOpen,
    setLoopsOpen,
    chordsOpen,
    setChordsOpen,
    chordBusy,
    samplerMelody,
    setSamplerMelody,
    loopBusy,
    placeInstrument,
    bakeSynth,
    editInstrument,
    bakeDrums,
    bakeSamplerPads,
    bakeSamplerMelody,
    placeLoop,
    placeLoopById,
    placeCloudTrack,
    placeChords,
    bakeSampler,
  };
}
