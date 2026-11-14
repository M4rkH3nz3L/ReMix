/**
 * 🔁 V2 (AUDIO-PROD) — beépített loop-csomag. Döntés 2026-11-14: ami a telefonon van, ingyenes; a szerveres
 * könyvtár Pro. A loopok NEM hangfájlok, hanem minták (dob-rács, hangjegyek), amelyeket a telefon a saját dob-
 * és szinti-motorjával a PROJEKT TEMPÓJÁN süt ki — így nem foglalnak helyet, licenc-gond nincs, és mindig
 * ütemre szólnak (nyújtás nélkül). Sütés után a szokásos hangszer-minta (`InstrumentDoc`) lesz belőlük: a
 * dob-gépben / a piano rollban tovább szerkeszthetők. Pure, expo-mentes.
 */
import { DRUM_ACCENT, DRUM_SOFT, DRUM_VOICES, emptyPattern, STEPS_PER_BAR, type DrumPattern, type DrumVelocity, type DrumVoice } from '@/lib/drums';
import type { SynthNote, SynthWave } from '@/lib/synth';

export type LoopCategory = 'drums' | 'bass' | 'chords' | 'melody';
export const LOOP_CATEGORIES: readonly LoopCategory[] = ['drums', 'bass', 'chords', 'melody'];

/** a sütött loop hossza ütemben (a minta ismétlődik) */
export const LOOP_BARS = 4;

export type DrumDef = {
  kind: 'drums';
  /** 1 vagy 2 ütemes minta: hangonként a 16-od lépések (a 2. ütem lépései 16-tól) */
  steps: Partial<Record<DrumVoice, number[]>>;
  accent?: Partial<Record<DrumVoice, number[]>>;
  soft?: Partial<Record<DrumVoice, number[]>>;
  swing?: number;
  /** 🛍️ V4: a hangcsomag loopja 4 ütemes is lehet */
  len: 1 | 2 | 4;
};
/** hangjegy: [midi, kezdet beatben, hossz beatben, velocity?] egy `len` ütemes mintán belül */
export type NoteDef = [number, number, number, number?];
export type SynthDef = { kind: 'synth'; wave: SynthWave; notes: NoteDef[]; len: 1 | 2 | 4 };

export interface BuiltinLoop {
  id: string;
  category: LoopCategory;
  /** a megjelenített név kulcsa (`studio.audio.loops.name.<id>`) */
  def: DrumDef | SynthDef;
  /** a hangnem (a dallamos loopoknál), tájékoztató */
  key?: string;
  /** 🛍️ V4: a hangcsomag loopjának saját neve (a beépítettek az i18n-kulcsból) */
  name?: string;
}

const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
const sixteenths = Array.from({ length: 16 }, (_, i) => i);
const chord = (root: number, third: number, fifth: number, at: number, len: number, v = 90): NoteDef[] => [
  [root, at, len, v],
  [third, at, len, v],
  [fifth, at, len, v],
];

export const BUILTIN_LOOPS: readonly BuiltinLoop[] = [
  // ── dob ────────────────────────────────────────────────────────────────────────────────
  { id: 'rock', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 8, 10], snare: [4, 12], hihat: eighths }, accent: { snare: [4, 12] } } },
  { id: 'house', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 4, 8, 12], clap: [4, 12], hihat: [2, 6, 10, 14], perc: [3, 11] }, accent: { kick: [0] } } },
  { id: 'hiphop', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 3, 8, 10], snare: [4, 12], hihat: eighths, rim: [7, 15] }, accent: { snare: [4, 12] }, swing: 0.2 } },
  { id: 'trap', category: 'drums', def: { kind: 'drums', len: 2, steps: { kick: [0, 7, 10, 16, 19, 26], snare: [8, 24], hihat: [...sixteenths, ...sixteenths.map((s) => s + 16)], clap: [8, 24] }, soft: { hihat: [1, 3, 5, 9, 11, 13, 17, 19, 21, 25, 27, 29] } } },
  { id: 'funk', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 3, 10], snare: [4, 7, 12, 15], hihat: sixteenths }, soft: { snare: [7, 15], hihat: [1, 3, 5, 7, 9, 11, 13, 15] } } },
  { id: 'lofi', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 7, 10], snare: [4, 12], hihat: eighths, rim: [14] }, soft: { hihat: [2, 6, 10, 14] }, swing: 0.3 } },
  { id: 'dnb', category: 'drums', def: { kind: 'drums', len: 2, steps: { kick: [0, 10, 16, 26], snare: [4, 12, 20, 28], hihat: [...eighths, ...eighths.map((s) => s + 16)], crash: [0] }, soft: { hihat: [2, 6, 10, 14, 18, 22, 26, 30] } } },
  { id: 'reggaeton', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hihat: eighths } } },
  // ── basszus (A-moll) ───────────────────────────────────────────────────────────────────
  { id: 'bassPulse', category: 'bass', key: 'Am', def: { kind: 'synth', wave: 'sawtooth', len: 1, notes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b, i) => [i % 2 ? 57 : 45, b, 0.45, i % 2 ? 80 : 110] as NoteDef) } },
  { id: 'bassWalk', category: 'bass', key: 'Am', def: { kind: 'synth', wave: 'triangle', len: 1, notes: [[45, 0, 0.9], [48, 1, 0.9], [50, 2, 0.9], [52, 3, 0.9]] } },
  { id: 'bassDisco', category: 'bass', key: 'Am', def: { kind: 'synth', wave: 'square', len: 2, notes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5].map((b, i) => [(b < 4 ? 45 : 41) + (i % 2 ? 12 : 0), b, 0.4, 100] as NoteDef) } },
  { id: 'bassSub', category: 'bass', key: 'Am', def: { kind: 'synth', wave: 'sine', len: 4, notes: [[33, 0, 3.9, 120], [29, 4, 3.9, 120], [36, 8, 3.9, 120], [31, 12, 3.9, 120]] } },
  // ── akkordok (C-dúr / A-moll) ──────────────────────────────────────────────────────────
  { id: 'chordsPop', category: 'chords', key: 'C', def: { kind: 'synth', wave: 'triangle', len: 4, notes: [...chord(57, 60, 64, 0, 3.8), ...chord(53, 57, 60, 4, 3.8), ...chord(48, 52, 55, 8, 3.8), ...chord(55, 59, 62, 12, 3.8)] } },
  { id: 'chordsPad', category: 'chords', key: 'C', def: { kind: 'synth', wave: 'sine', len: 4, notes: [...chord(60, 64, 67, 0, 4, 80), ...chord(55, 59, 62, 4, 4, 80), ...chord(57, 60, 64, 8, 4, 80), ...chord(53, 57, 60, 12, 4, 80)] } },
  { id: 'chordsJazz', category: 'chords', key: 'C', def: { kind: 'synth', wave: 'triangle', len: 4, notes: [[50, 0, 3.8, 85], [53, 0, 3.8, 85], [57, 0, 3.8, 85], [60, 0, 3.8, 85], [55, 4, 3.8, 85], [59, 4, 3.8, 85], [62, 4, 3.8, 85], [65, 4, 3.8, 85], [48, 8, 7.8, 85], [52, 8, 7.8, 85], [55, 8, 7.8, 85], [59, 8, 7.8, 85]] } },
  { id: 'chordsStabs', category: 'chords', key: 'Am', def: { kind: 'synth', wave: 'sawtooth', len: 2, notes: [...chord(57, 60, 64, 0.5, 0.3), ...chord(57, 60, 64, 1.5, 0.3), ...chord(57, 60, 64, 2.5, 0.3), ...chord(57, 60, 64, 3.5, 0.3), ...chord(53, 57, 60, 4.5, 0.3), ...chord(53, 57, 60, 5.5, 0.3), ...chord(55, 59, 62, 6.5, 0.3), ...chord(55, 59, 62, 7.5, 0.3)] } },
  // ── dallam / arpeggio ──────────────────────────────────────────────────────────────────
  { id: 'arpMinor', category: 'melody', key: 'Am', def: { kind: 'synth', wave: 'square', len: 1, notes: [69, 72, 76, 81, 76, 72, 69, 72, 76, 81, 84, 81, 76, 72, 76, 72].map((m, i) => [m, i * 0.25, 0.22, i % 4 ? 80 : 110] as NoteDef) } },
  { id: 'pentaRiff', category: 'melody', key: 'Am', def: { kind: 'synth', wave: 'triangle', len: 2, notes: [[69, 0, 0.5], [72, 0.5, 0.5], [74, 1, 1], [76, 2.5, 0.5], [74, 3, 1], [72, 4, 0.5], [69, 4.5, 0.5], [67, 5, 1], [69, 6, 2]] } },
  { id: 'pluck', category: 'melody', key: 'C', def: { kind: 'synth', wave: 'sawtooth', len: 1, notes: [[72, 0, 0.2], [79, 0.75, 0.2], [76, 1.5, 0.2], [72, 2, 0.2], [79, 2.75, 0.2], [81, 3.5, 0.2]] } },
  { id: 'bells', category: 'melody', key: 'C', def: { kind: 'synth', wave: 'sine', len: 2, notes: [[84, 0, 1, 90], [79, 1, 1, 80], [76, 2, 1, 80], [79, 3, 1, 80], [81, 4, 1.5, 90], [79, 5.5, 0.5, 80], [76, 6, 2, 80]] } },
];

/** a loop dob-mintája `LOOP_BARS` ütemre ismételve (+ hangsúly/halk, swing) */
export function loopDrums(def: DrumDef): { pattern: DrumPattern; velocity: DrumVelocity; swing: number } {
  const pattern = emptyPattern(LOOP_BARS);
  const velocity: DrumVelocity = {};
  const span = def.len * STEPS_PER_BAR;
  for (const v of DRUM_VOICES) {
    for (let rep = 0; rep < LOOP_BARS / def.len; rep++) {
      const off = rep * span;
      for (const s of def.steps[v] ?? []) pattern[v][off + s] = true;
      for (const s of def.accent?.[v] ?? []) (velocity[v] = velocity[v] ?? [])[off + s] = DRUM_ACCENT;
      for (const s of def.soft?.[v] ?? []) (velocity[v] = velocity[v] ?? [])[off + s] = DRUM_SOFT;
    }
  }
  return { pattern, velocity, swing: def.swing ?? 0 };
}

/** a loop hangjegyei `LOOP_BARS` ütemre ismételve (egyedi azonosítóval) */
export function loopNotes(def: SynthDef, idPrefix = 'n'): SynthNote[] {
  const out: SynthNote[] = [];
  const beats = def.len * 4;
  for (let rep = 0; rep < LOOP_BARS / def.len; rep++) {
    def.notes.forEach(([midi, start, length, velocity], i) => {
      out.push({ id: `${idPrefix}${rep}_${i}`, midi, startBeat: rep * beats + start, lengthBeats: length, ...(velocity ? { velocity } : {}) });
    });
  }
  return out;
}

export function loopsIn(category: LoopCategory): BuiltinLoop[] {
  return BUILTIN_LOOPS.filter((l) => l.category === category);
}
