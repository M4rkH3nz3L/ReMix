/**
 * 🥁 Dob-gép / step-sequencer mag (AUDIOT §5) — pure + tesztelt.
 *
 * A dob-minta egy RÁCS: hangonként (kick/snare/hihat/clap) 16 lépés/ütem. A hangokat a worker
 * (`server/drums.js`) SZINTETIZÁLJA (nincs minta-fájl-függés), a lépés-időzítés itt él (BPM →
 * lépés-mp), hogy önmagában tesztelhető legyen. Expo-mentes.
 */

export type DrumVoice = 'kick' | 'snare' | 'hihat' | 'clap';

export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'hihat', 'clap'];
export const STEPS_PER_BAR = 16; // 16-od felbontás

export type DrumPattern = Record<DrumVoice, boolean[]>;
export interface DrumHit {
  voice: DrumVoice;
  step: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Egy lépés hossza mp-ben: 1 ütem = 4 beat = 16 lépés → lépés = (60/bpm)/4. */
export function stepSec(bpm: number): number {
  return round(60 / (bpm > 0 ? bpm : 120) / 4);
}

/** Lépés-szám `bars` ütemre. */
export function stepCount(bars: number): number {
  return Math.max(1, Math.floor(bars)) * STEPS_PER_BAR;
}

/** Üres minta (minden hang × minden lépés = false). */
export function emptyPattern(bars: number): DrumPattern {
  const n = stepCount(bars);
  const p = {} as DrumPattern;
  for (const v of DRUM_VOICES) {
    p[v] = new Array(n).fill(false);
  }
  return p;
}

/** Egy cella be/ki (immutábilis). */
export function toggleStep(pattern: DrumPattern, voice: DrumVoice, step: number): DrumPattern {
  const row = pattern[voice] ?? [];
  if (step < 0 || step >= row.length) {
    return pattern;
  }
  const next = row.slice();
  next[step] = !next[step];
  return { ...pattern, [voice]: next };
}

/** A minta aktív ütései (voice + step) — a worker bemenete. */
export function patternHits(pattern: DrumPattern): DrumHit[] {
  const hits: DrumHit[] = [];
  for (const v of DRUM_VOICES) {
    (pattern[v] ?? []).forEach((on, step) => {
      if (on) {
        hits.push({ voice: v, step });
      }
    });
  }
  return hits;
}

/** Egy ütés időpontja mp-ben. */
export function hitTimeSec(step: number, bpm: number): number {
  return round(Math.max(0, step) * stepSec(bpm));
}

/** A minta teljes hossza mp-ben (a teljes rács, nem csak az utolsó ütés). */
export function patternDurationSec(bars: number, bpm: number): number {
  return round(stepCount(bars) * stepSec(bpm));
}

/** Van-e bármi aktív ütés. */
export function hasHits(pattern: DrumPattern): boolean {
  return DRUM_VOICES.some((v) => (pattern[v] ?? []).some(Boolean));
}

/** Rövid címke a hang-sorokhoz. */
export const DRUM_LABEL: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hihat',
  clap: 'Clap',
};
