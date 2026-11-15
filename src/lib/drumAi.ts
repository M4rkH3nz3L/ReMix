/**
 * 🥁 V8: AI-dob a dobgépben (expo-mentes, tiszta mag) — a Drums RNN (`drumRnn`) a dobgép rácsán:
 * - `continue` (folytatás): a meglévő ütemek után a következőket a modell írja (legfeljebb 4 ütemig)
 * - `vary` (variáció): az első ütem marad, a többit (1 ütemnél az első beat utánit) újraírja
 * - `groove` (új groove): egy lábdobból indul, a teljes rácsot a modell írja
 * A megtartott rész ütés-szintjei maradnak; az új részben a nyitott hi-hat hangsúlyos hi-hat.
 */
import type { DrumRnn } from '@/lib/drumRnn';
import { labelsToPattern, patternToLabels } from '@/lib/drumRnn';
import { DRUM_ACCENT, DRUM_VOICES, STEPS_PER_BAR, type DrumPattern, type DrumVelocity } from '@/lib/drums';

export type DrumAiMode = 'continue' | 'vary' | 'groove';
/** kreativitás → hőmérséklet */
export const DRUM_AI_TEMPS = { safe: 0.8, creative: 1.0, bold: 1.3 } as const;
export type DrumAiTemp = keyof typeof DRUM_AI_TEMPS;
export const DRUM_AI_MAX_BARS = 4;

export interface DrumGrid {
  bars: number;
  pattern: DrumPattern;
  velocity: DrumVelocity;
}

/** a rács utolsó, ütést tartalmazó üteme (1-alapú; 0 = üres) */
export function usedBars(pattern: DrumPattern, bars: number): number {
  for (let b = bars; b >= 1; b--) {
    for (const v of DRUM_VOICES) {
      const row = pattern[v] ?? [];
      for (let s = (b - 1) * STEPS_PER_BAR; s < b * STEPS_PER_BAR; s++) if (row[s]) return b;
    }
  }
  return 0;
}

/**
 * Az AI-művelet a rácson: a megtartott lépések (primer) után a modell lép; az új rács a régi szintjeivel a
 * megtartott részen. `random` az álvéletlen (teszt: determinisztikus).
 */
export function aiDrumGrid(model: DrumRnn, grid: DrumGrid, mode: DrumAiMode, temperature: number, random: () => number): DrumGrid {
  const used = usedBars(grid.pattern, grid.bars);
  let bars = grid.bars;
  let keep: number; // a megtartott lépések száma
  if (mode === 'groove' || used === 0) {
    keep = 0;
  } else if (mode === 'continue' && used < DRUM_AI_MAX_BARS) {
    bars = Math.max(bars, used + 1);
    keep = used * STEPS_PER_BAR;
  } else if (bars > 1 && mode === 'vary') {
    keep = STEPS_PER_BAR;
  } else {
    // 1 ütemes variáció / a teli rács folytatása: az első beat marad
    keep = 4;
  }
  const steps = bars * STEPS_PER_BAR;
  const labels = patternToLabels(grid.pattern, steps);
  // üres kezdés: egy lábdob az első lépésen (a modell ebből indul)
  const primer = keep > 0 ? labels.slice(0, keep) : [1];
  const gen = model.continue(primer, steps - primer.length, temperature, random).labels;
  const all = [...primer, ...gen].slice(0, steps);
  const { pattern, accents } = labelsToPattern(all);
  const velocity: DrumVelocity = {};
  for (const v of DRUM_VOICES) {
    const row = new Array<number | undefined>(steps).fill(undefined);
    const old = grid.velocity[v] ?? [];
    for (let s = 0; s < Math.min(keep, steps); s++) if (old[s] !== undefined) row[s] = old[s];
    for (const s of accents[v] ?? []) if (s >= keep) row[s] = DRUM_ACCENT;
    if (row.some((x) => x !== undefined)) velocity[v] = row;
  }
  // a megtartott rész a régi rácsból (a modell-kódolás a clap/rim-et pergőnek látja — ott az eredeti marad)
  for (const v of DRUM_VOICES) {
    const old = grid.pattern[v] ?? [];
    for (let s = 0; s < Math.min(keep, steps); s++) pattern[v][s] = !!old[s];
  }
  return { bars, pattern: pattern as DrumPattern, velocity };
}
