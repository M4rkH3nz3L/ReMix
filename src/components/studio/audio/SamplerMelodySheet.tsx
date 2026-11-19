import { useTranslation } from 'react-i18next';

import type { SamplerMelody } from '@/components/studio/audio/body/useInstrumentStudio';
import { PianoRollSheet } from '@/components/studio/audio/PianoRollSheet';
import { decodeSample } from '@/lib/instrumentClient';
import { playPcm } from '@/lib/instrumentPreview';
import { renderSamplerNotesPcm } from '@/lib/samplerPlus';
import type { SynthNote } from '@/lib/synth';
import type { InstrumentDoc } from '@/types/project';

/**
 * 🎛️ V2.3: a sampler Dallam módja — a piano roll a minta hangjával (kromatikusan, a gyökérhanghoz képest). Az
 * újraszerkesztett sampler-minta hangjaival indul; a sütés a hívónál (klip + minta, egy undo).
 */
export function SamplerMelodySheet({
  melody,
  bpm,
  busy,
  editDoc,
  onClose,
  onBake,
}: {
  melody: SamplerMelody;
  bpm: number;
  busy: boolean;
  /** az újraszerkesztett minta (csak a dallamos sampler-minta számít) */
  editDoc: InstrumentDoc | null;
  onClose: () => void;
  onBake: (notes: SynthNote[], bars: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <PianoRollSheet
      bpm={bpm}
      busy={busy}
      initial={editDoc?.kind === 'sampler' && editDoc.sampler?.notes ? editDoc : null}
      voice={{
        label: t('studio.sampler.melodyLabel', { name: melody.sampleName || t('studio.sampler.title', { defaultValue: 'Sampler' }) }),
        audition: (m, vel) => {
          void decodeSample(melody.sampleUri).then((x) => x && playPcm(renderSamplerNotesPcm(x, [{ id: 'a', midi: m, startBeat: 0, lengthBeats: 1, velocity: vel }], melody.rootMidi, bpm)));
        },
        render: async (notes, b) => {
          const x = await decodeSample(melody.sampleUri);
          return x ? renderSamplerNotesPcm(x, notes, melody.rootMidi, b) : null;
        },
      }}
      onClose={onClose}
      onBake={(notes, _wave, bars) => onBake(notes, bars)}
    />
  );
}
