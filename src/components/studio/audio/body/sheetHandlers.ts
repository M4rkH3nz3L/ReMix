import type { ComponentProps } from 'react';

import type { TransportInstrument } from '@/components/studio/audio/AudioTransportBar';

import type { AudioStudioSheets } from './AudioStudioSheets';
import type { clipAiActions } from './clipAiActions';
import type { useInstrumentStudio } from './useInstrumentStudio';

type Instruments = ReturnType<typeof useInstrumentStudio>;
type SheetHandlers = Pick<
  ComponentProps<typeof AudioStudioSheets>,
  | 'setPianoRoll'
  | 'setDrumMachine'
  | 'setSampler'
  | 'onBakeSynth'
  | 'onBakeDrums'
  | 'onEditInstrument'
  | 'onOpenLoops'
  | 'onTune'
  | 'onHumMelody'
  | 'onStemsOnDevice'
  | 'onAiDenoise'
  | 'onResetAiDenoise'
  | 'onResetTune'
  | 'onBakeSamplerPads'
  | 'onSamplerMelody'
  | 'onBakeSampler'
>;

/**
 * 🎹🤖 A lapok (`AudioStudioSheets`) hangszer- és klip-AI kezelői: a hangszer-lap bezárása a szerkesztett
 * dokumentumot is elengedi; a sütés / AI-műveletek a `useInstrumentStudio` és a `clipAiActions` útján
 * (egy köteg = egy undo a command buson).
 */
export function studioSheetHandlers({
  inst,
  ai,
  setEditing,
}: {
  inst: Instruments;
  ai: ReturnType<typeof clipAiActions>;
  setEditing: (v: boolean) => void;
}): SheetHandlers {
  return {
    setPianoRoll: (v) => {
      inst.setPianoRoll(v);
      if (!v) inst.setEditDocId(null);
    },
    setDrumMachine: (v) => {
      inst.setDrumMachine(v);
      if (!v) inst.setEditDocId(null);
    },
    setSampler: (v) => {
      inst.setSampler(v);
      if (!v) inst.setEditDocId(null);
    },
    onBakeSynth: (notes, wave, bars) => void inst.bakeSynth(notes, wave, bars),
    onBakeDrums: (hits, bars, src) => void inst.bakeDrums(hits, bars, src),
    onEditInstrument: inst.editInstrument,
    onOpenLoops: () => inst.setLoopsOpen(true),
    onTune: (id, s) => {
      setEditing(false);
      void ai.applyTune(id, s);
    },
    onHumMelody: (id, k) => void ai.humMelody(id, k),
    onStemsOnDevice: (id) => void ai.stemsOnDevice(id),
    onAiDenoise: (id, strength) => void ai.applyAiDenoise(id, strength),
    onResetAiDenoise: ai.resetAiDenoise,
    onResetTune: (id) => {
      setEditing(false);
      ai.resetTune(id);
    },
    onBakeSamplerPads: (uri, slices, pads, bars, name) => void inst.bakeSamplerPads(uri, slices, pads, bars, name),
    onSamplerMelody: (uri, name, rootMidi) => {
      inst.setSampler(false);
      inst.setSamplerMelody({ sampleUri: uri, sampleName: name, rootMidi });
    },
    onBakeSampler: (uri, pattern, bars, name) => void inst.bakeSampler(uri, pattern, bars, name),
  };
}

/** a transzport hangszer-gombja: a megfelelő hangszer-lap nyitása */
export function openInstrumentOf(inst: Instruments) {
  return (which: TransportInstrument) => {
    if (which === 'pianoRoll') inst.setPianoRoll(true);
    else if (which === 'drums') inst.setDrumMachine(true);
    else if (which === 'sampler') inst.setSampler(true);
    else if (which === 'loops') inst.setLoopsOpen(true);
    else inst.setChordsOpen(true);
  };
}
