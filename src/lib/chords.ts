/**
 * 🎼 AUDIO-PROD V3.1 — akkordmenet: hangnem + menet (római számok) → négy szerkeszthető minta (akkordok, basszus,
 * arpeggio, dob), amelyeket a telefon a projekt tempóján süt, egy undo-lépésben négy sávra. Pure, expo-mentes.
 *
 * - diatonikus hármashangzatok a hangnem skálájából (dúr: I ii iii IV V vi vii°, moll: i ii° III iv v VI VII);
 * - hangvezetés: minden akkord abba a fordításba kerül, amelyik a legközelebb van az előzőhöz (C4 körül);
 * - basszus: az akkord alaphangja a 2. oktávban, nyolcadokban (az utolsó pár ütésnél ötöddel);
 * - arpeggio: az akkordhangok felfelé, 16-odokban, az 5. oktávban.
 */
import { DRUM_ACCENT, emptyPattern, type DrumPattern, type DrumVelocity } from '@/lib/drums';
import { diatonicStep, type MusicKey } from '@/lib/pitch';
import type { SynthNote } from '@/lib/synth';

export type ChordProgressionId = 'pop' | 'sad' | 'classic' | 'fifties' | 'jazz' | 'epic';
/** a menetek fokokban (1-alapú), ütemenként egy akkord */
export const PROGRESSIONS: Record<ChordProgressionId, number[]> = {
  pop: [1, 5, 6, 4],
  sad: [6, 4, 1, 5],
  classic: [1, 4, 5, 1],
  fifties: [1, 6, 4, 5],
  jazz: [2, 5, 1, 1],
  epic: [6, 5, 4, 5],
};
export const PROGRESSION_IDS = Object.keys(PROGRESSIONS) as ChordProgressionId[];
export const NOTE_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** a fok alaphangja a megadott oktávban (MIDI) */
function degreeRoot(key: MusicKey, degree: number, octaveMidi: number): number {
  return diatonicStep(octaveMidi + key.root, degree - 1, key);
}

/** a fok diatonikus hármashangzata alaphelyzetben (alaphang, terc, kvint) */
export function diatonicTriad(key: MusicKey, degree: number, octaveMidi = 48): number[] {
  const root = degreeRoot(key, degree, octaveMidi);
  return [root, diatonicStep(root, 2, key), diatonicStep(root, 4, key)];
}

/** az akkord neve (pl. C, Am, Bdim) */
export function chordName(key: MusicKey, degree: number): string {
  const [r, t, f] = diatonicTriad(key, degree);
  const third = t - r;
  const fifth = f - r;
  const quality = third === 4 ? '' : fifth === 6 ? 'dim' : 'm';
  return `${NOTE_ROOTS[r % 12]}${quality}`;
}

/** a fok római száma (dúr: nagy, moll: kicsi, szűkített: °) */
export function romanNumeral(key: MusicKey, degree: number): string {
  const R = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degree - 1] ?? '?';
  const [r, t, f] = diatonicTriad(key, degree);
  if (t - r === 4) return R;
  return f - r === 6 ? `${R.toLowerCase()}°` : R.toLowerCase();
}

/** a hármashangzat az előző akkordhoz legközelebbi fordításban (a hangok összegének távolsága szerint) */
export function voiceLead(triad: number[], previous: number[] | null, center = 60): number[] {
  const target = previous ? previous.reduce((s, m) => s + m, 0) / previous.length : center;
  let best = triad;
  let bestD = Infinity;
  for (let shift = -24; shift <= 24; shift += 12) {
    for (let inv = 0; inv < 3; inv++) {
      const v = triad.map((m, i) => m + shift + (i < inv ? 12 : 0)).sort((a, b) => a - b);
      const d = Math.abs(v.reduce((s, m) => s + m, 0) / v.length - target);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = v;
      }
    }
  }
  return best;
}

export interface ChordParts {
  chords: SynthNote[];
  bass: SynthNote[];
  arp: SynthNote[];
  drums: { pattern: DrumPattern; velocity: DrumVelocity; swing: number };
  /** ütemenként az akkord neve és római száma (a felülethez) */
  labels: { name: string; roman: string }[];
  bars: number;
}

/** a menet négy része `progression.length` ütemre (ütemenként egy akkord, 4/4) */
export function chordParts(key: MusicKey, progression: readonly number[]): ChordParts {
  const chords: SynthNote[] = [];
  const bass: SynthNote[] = [];
  const arp: SynthNote[] = [];
  let prev: number[] | null = null;
  progression.forEach((degree, bar) => {
    const at = bar * 4;
    const voiced = voiceLead(diatonicTriad(key, degree), prev);
    prev = voiced;
    voiced.forEach((m, i) => chords.push({ id: `c${bar}_${i}`, midi: m, startBeat: at, lengthBeats: 3.9, velocity: 88 }));
    const root = degreeRoot(key, degree, 36);
    const fifth = diatonicStep(root, 4, key);
    for (let e = 0; e < 8; e++) bass.push({ id: `b${bar}_${e}`, midi: e >= 6 ? fifth : root, startBeat: at + e * 0.5, lengthBeats: 0.45, velocity: e % 2 ? 85 : 110 });
    const up = voiceLead(diatonicTriad(key, degree), [72, 76, 79]);
    const seq = [...up, up[0] + 12];
    for (let s = 0; s < 16; s++) arp.push({ id: `a${bar}_${s}`, midi: seq[s % 4], startBeat: at + s * 0.25, lengthBeats: 0.22, velocity: s % 4 ? 70 : 100 });
  });
  const bars = progression.length;
  const pattern = emptyPattern(bars);
  const velocity: DrumVelocity = { kick: [], snare: [] };
  for (let bar = 0; bar < bars; bar++) {
    const o = bar * 16;
    for (const s of [0, 8, 10]) pattern.kick[o + s] = true;
    for (const s of [4, 12]) pattern.snare[o + s] = true;
    for (let s = 0; s < 16; s += 2) pattern.hihat[o + s] = true;
    velocity.snare![o + 4] = DRUM_ACCENT;
  }
  pattern.crash[0] = true;
  return { chords, bass, arp, drums: { pattern, velocity, swing: 0 }, labels: progression.map((d) => ({ name: chordName(key, d), roman: romanNumeral(key, d) })), bars };
}
