/**
 * 🎛️🔊 Sampler mag (AUDIOT §5) — pure + tesztelt.
 *
 * A sampler a felhasználó SAJÁT mintáját (one-shot) helyezi egy step-rácsra (egy sor × 16-od
 * lépések/ütem) — a dob-géphez hasonlóan, de generált hangok helyett egy valódi hang-fájllal.
 * A step-időzítés a `drums.ts`-ből (közös 16-od rács); a worker a mintát `asplit`-tel többszörözi
 * és a lépés-időpontokra késlelteti. Expo-mentes.
 */
import { patternDurationSec, stepCount, STEPS_PER_BAR, stepSec } from '@/lib/drums';

export { STEPS_PER_BAR, stepSec };

export type SamplerPattern = boolean[];

/** Üres step-sor `bars` ütemre. */
export function emptySampler(bars: number): SamplerPattern {
  return new Array(stepCount(bars)).fill(false);
}

/** Egy cella be/ki (immutábilis, tartományon kívül no-op). */
export function toggleSamplerStep(pattern: SamplerPattern, step: number): SamplerPattern {
  if (step < 0 || step >= pattern.length) {
    return pattern;
  }
  const next = pattern.slice();
  next[step] = !next[step];
  return next;
}

/** Az aktív lépések indexei (a worker bemenete). */
export function activeSteps(pattern: SamplerPattern): number[] {
  return pattern.reduce<number[]>((acc, on, i) => (on ? (acc.push(i), acc) : acc), []);
}

/** Van-e bármi aktív lépés. */
export function samplerHasHits(pattern: SamplerPattern): boolean {
  return pattern.some(Boolean);
}

/** A teljes rács hossza mp-ben (a step-időzítés a dob-géppel közös). */
export function samplerDurationSec(bars: number, bpm: number): number {
  return patternDurationSec(bars, bpm);
}

/** A rács átméretezése új ütem-számra, a meglévő ütések megőrzésével. */
export function resizeSampler(pattern: SamplerPattern, bars: number): SamplerPattern {
  const next = emptySampler(bars);
  pattern.forEach((on, i) => {
    if (i < next.length) {
      next[i] = on;
    }
  });
  return next;
}
