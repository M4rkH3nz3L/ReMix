import { ChordSheet } from '@/components/studio/audio/ChordSheet';
import { LoopLibrarySheet } from '@/components/studio/audio/LoopLibrarySheet';
import { SamplerMelodySheet } from '@/components/studio/audio/SamplerMelodySheet';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import type { Project } from '@/types/project';

import type { useInstrumentStudio } from './useInstrumentStudio';

/**
 * 🎹 a lapok fölötti hangszer-lapok: sampler-dallam, akkordok, loop-könyvtár — a nyitottságuk és a
 * sütésük a `useInstrumentStudio`-ban
 */
export function InstrumentOverlays({
  inst,
  project,
  bpm,
}: {
  inst: ReturnType<typeof useInstrumentStudio>;
  project: Project;
  bpm: number;
}) {
  return (
    <>
      {inst.samplerMelody ? (
        <SamplerMelodySheet
          key={`sampler-melody-${inst.editDocId ?? 'new'}`}
          melody={inst.samplerMelody}
          bpm={bpm}
          busy={inst.samplerBusy}
          editDoc={instrumentDocOf(project, inst.editDocId ?? undefined)}
          onClose={() => {
            inst.setSamplerMelody(null);
            inst.setEditDocId(null);
          }}
          onBake={(notes, bars) => void inst.bakeSamplerMelody(notes, bars)}
        />
      ) : null}
      {inst.chordsOpen ? <ChordSheet bpm={bpm} busy={inst.chordBusy} onPlace={(key, prog, parts) => void inst.placeChords(key, prog, parts)} onClose={() => inst.setChordsOpen(false)} /> : null}
      {inst.loopsOpen ? <LoopLibrarySheet bpm={bpm} busyId={inst.loopBusy} onPick={(l) => void inst.placeLoop(l)} onPickCloud={(tr) => void inst.placeCloudTrack(tr)} onClose={() => inst.setLoopsOpen(false)} /> : null}
    </>
  );
}
