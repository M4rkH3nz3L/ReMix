import { SourceSheet } from '@/components/SourceSheet';
import { AddMediaSheet } from '@/components/studio/audio/AddMediaSheet';
import { AudioSheetFrameContext, type AudioSheetFrameValue } from '@/components/studio/audio/AudioSheetFrame';
import { AlbumSheet } from '@/components/studio/audio/AlbumSheet';
import { ClipEditSheet } from '@/components/studio/audio/ClipEditSheet';
import { MasterSheet } from '@/components/studio/audio/MasterSheet';
import { DrumMachineSheet, type DrumSource } from '@/components/studio/audio/DrumMachineSheet';
import { MixerSheet } from '@/components/studio/audio/MixerSheet';
import { PianoRollSheet } from '@/components/studio/audio/PianoRollSheet';
import { SamplerSheet } from '@/components/studio/audio/SamplerSheet';
import { TtsSheet } from '@/components/studio/audio/TtsSheet';
import type { SynthNote, SynthWave } from '@/lib/synth';
import type { DrumHit } from '@/lib/drums';
import type { SamplerPattern } from '@/lib/sampler';
import type { Asset, AudioClip, InstrumentDoc } from '@/types/project';

/**
 * 🗂️ Sheet-host — a hang-stúdió mód-állapotaitól (`editing`/`mastering`/`mixerOpen`/…)
 * függő szerkesztő-lapok feltételes renderelése. VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `AudioStudioBody`-ból: pontosan ugyanaz a feltétel-lánc, render-sorrend és
 * prop-átadás, mint korábban a body JSX-ében — minden állapot/handler/érték
 * PROPBÓL érkezik (a body adja át). A busy-flagek és a bake-callbackek a body
 * felől jönnek, a command-/dispatch-minta változatlan.
 */
export function AudioStudioSheets({
  selClip,
  fps,
  bpm,
  editing,
  mastering,
  mixerOpen,
  adding,
  tts,
  pianoRoll,
  pianoBusy,
  drumMachine,
  drumBusy,
  sampler,
  samplerBusy,
  source,
  albumOpen,
  setEditing,
  setMastering,
  setMixerOpen,
  setAdding,
  setTts,
  setPianoRoll,
  setDrumMachine,
  setSampler,
  setSource,
  setAlbumOpen,
  onBakeSynth,
  onBakeDrums,
  onBakeSampler,
  onInsertSource,
  onShareAlbum,
  editDoc = null,
  onEditInstrument,
  frame = null,
}: {
  selClip: AudioClip | null;
  fps: number;
  bpm: number;
  editing: boolean;
  mastering: boolean;
  mixerOpen: boolean;
  adding: boolean;
  tts: boolean;
  pianoRoll: boolean;
  pianoBusy: boolean;
  drumMachine: boolean;
  drumBusy: boolean;
  sampler: boolean;
  samplerBusy: boolean;
  source: boolean;
  albumOpen: boolean;
  setEditing: (v: boolean) => void;
  setMastering: (v: boolean) => void;
  setMixerOpen: (v: boolean) => void;
  setAdding: (v: boolean) => void;
  setTts: (v: boolean) => void;
  setPianoRoll: (v: boolean) => void;
  setDrumMachine: (v: boolean) => void;
  setSampler: (v: boolean) => void;
  setSource: (v: boolean) => void;
  setAlbumOpen: (v: boolean) => void;
  onBakeSynth: (notes: SynthNote[], wave: SynthWave, bars: number) => void;
  onBakeDrums: (hits: DrumHit[], bars: number, src: DrumSource) => void;
  /** 🎹🥁 az újraszerkesztett hangszer-minta (null = új) */
  editDoc?: InstrumentDoc | null;
  /** a klipszerkesztő „Minta szerkesztése” gombja */
  onEditInstrument?: (docId: string) => void;
  onBakeSampler: (uri: string, pattern: SamplerPattern, bars: number) => void;
  onInsertSource: (asset: Asset) => void;
  onShareAlbum: () => void;
  /** 📐 inline/workspace keret (MOBILE-UI §6.7); null → minden lap a régi modális keretben */
  frame?: AudioSheetFrameValue | null;
}) {
  return (
    <AudioSheetFrameContext.Provider value={frame}>
      {editing && selClip ? <ClipEditSheet key={`${selClip.id}:${selClip.kind === 'audio' ? `${selClip.activeTake ?? ''}:${selClip.speed ?? 1}:${selClip.uri}` : ''}`} clip={selClip} fps={fps} onClose={() => setEditing(false)} onEditInstrument={onEditInstrument} /> : null}
      {mastering ? <MasterSheet onClose={() => setMastering(false)} /> : null}
      {mixerOpen ? (
        <MixerSheet
          onClose={() => setMixerOpen(false)}
          onOpenMaster={() => {
            setMixerOpen(false);
            setMastering(true);
          }}
        />
      ) : null}
      {adding ? (
        <AddMediaSheet
          track="music"
          onClose={() => setAdding(false)}
          onTts={() => {
            setAdding(false);
            setTts(true);
          }}
          onPianoRoll={() => {
            setAdding(false);
            setPianoRoll(true);
          }}
          onDrums={() => {
            setAdding(false);
            setDrumMachine(true);
          }}
          onSampler={() => {
            setAdding(false);
            setSampler(true);
          }}
        />
      ) : null}
      {tts ? <TtsSheet onClose={() => setTts(false)} /> : null}
      {pianoRoll ? (
        <PianoRollSheet key={editDoc?.id ?? 'new'} initial={editDoc?.kind === 'synth' ? editDoc : null} bpm={bpm} busy={pianoBusy} onClose={() => setPianoRoll(false)} onBake={(notes, wave, bars) => onBakeSynth(notes, wave, bars)} />
      ) : null}
      {drumMachine ? (
        <DrumMachineSheet key={editDoc?.id ?? 'new'} initial={editDoc?.kind === 'drums' ? editDoc : null} bpm={bpm} busy={drumBusy} onClose={() => setDrumMachine(false)} onBake={(hits, bars, src) => onBakeDrums(hits, bars, src)} />
      ) : null}
      {sampler ? (
        <SamplerSheet bpm={bpm} busy={samplerBusy} onClose={() => setSampler(false)} onBake={(uri, pattern, bars) => onBakeSampler(uri, pattern, bars)} />
      ) : null}
      {source ? <SourceSheet onInsert={onInsertSource} onClose={() => setSource(false)} /> : null}
      {albumOpen ? <AlbumSheet onClose={() => setAlbumOpen(false)} onShareAlbum={() => onShareAlbum()} /> : null}
    </AudioSheetFrameContext.Provider>
  );
}
