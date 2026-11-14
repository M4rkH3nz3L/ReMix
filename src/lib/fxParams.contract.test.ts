import { delayTimeMs, eqBandParams } from '@/lib/fxParams';
import type { AudioFx } from '@/types/project';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const worker = require('../../server/voicechain');

/** 🎛️ V7 szerződés: a kliens DSP és a szerver ffmpeg-lánca ugyanazt az EQ-t és delay-időt kapja. */
describe('🎛️ V7 kliens ↔ szerver', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const cases: AudioFx[] = [
    {},
    { eq: { low: 3, mid: -4, high: 6 } },
    { delay: 0.4 },
    { delay: 0.4, delayBeats: 0.75, delayMs: 375 },
    { delay: 0.4, delayBeats: 0.75 },
    { delay: 1, delayBeats: 2, delayMs: 99999 },
  ];
  for (let i = 0; i < 40; i++) {
    cases.push({
      eq: {
        low: Math.round(rnd() * 30 - 15), mid: Math.round(rnd() * 30 - 15), high: Math.round(rnd() * 30 - 15),
        lowFreq: rnd() * 800, midFreq: rnd() * 10000, highFreq: rnd() * 25000,
        lowQ: rnd() * 10, midQ: rnd() < 0.2 ? undefined : rnd() * 10, highQ: rnd() * 10,
      },
      delay: rnd(), ...(rnd() < 0.5 ? { delayBeats: 0.5, delayMs: Math.round(rnd() * 3000) } : {}),
    });
  }

  it.each(cases.map((c, i) => [i, c] as const))('#%i: azonos sávok és delay-idő, a szerver-lánc ezt írja', (_i, fx) => {
    expect(worker.eqBandParams(fx.eq)).toEqual(eqBandParams(fx.eq));
    expect(worker.delayTimeMs(fx)).toBe(delayTimeMs(fx));
    const chain: string = worker.audioFxChain(fx);
    for (const b of eqBandParams(fx.eq)) {
      if (b.gain) expect(chain).toContain(`equalizer=f=${b.freq}:t=q:w=${b.q}:g=${b.gain}`);
    }
    if ((fx.delay ?? 0) > 0) expect(chain).toContain(`aecho=0.8:0.6:${delayTimeMs(fx)}:`);
  });
});
