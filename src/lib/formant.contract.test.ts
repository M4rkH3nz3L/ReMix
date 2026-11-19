import { formantCorrect } from '@/lib/formant';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti
const worker = require('../../server/lib/formant');

/** 🗣️ V7.3 szerződés: a telefon és a szerver formáns-korrekciója bitre azonos. */
describe('🗣️ formantCorrect kliens ↔ szerver', () => {
  it('bitre azonos kimenet zajra és szinuszokra, eltérő hosszú referenciával is', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const ref = Float32Array.from({ length: 12000 }, (_, i) => 0.3 * Math.sin(i / 9) + 0.05 * rnd());
    const sh = Float32Array.from({ length: 11000 }, (_, i) => 0.3 * Math.sin(i / 6) + 0.05 * rnd());
    const a = formantCorrect(ref, sh, 44100);
    const b: Float32Array = worker.formantCorrect(ref, sh, 44100);
    expect(b.length).toBe(a.length);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(worker.formantCorrect(ref, sh, 48000) as Float32Array)).toEqual(Array.from(formantCorrect(ref, sh, 48000)));
  });
});
