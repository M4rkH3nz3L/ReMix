/**
 * 🎤 Vocal Studio pitch-mag (S-VOCAL — MASTER §6) — a hangmagasság zenei-elméleti
 * TISZTA magja: note ↔ frekvencia ↔ MIDI, skálák, skálára-illesztés,
 * **pitch-correction terv** (auto-tune, állítható erősséggel) és **diatonikus
 * harmónia-generálás**. A tényleges pitch-shift a workeren megy (Rubber Band /
 * SoundTouch / world — `pitchCorrect` capability); ez a determinisztikus TERV,
 * ami kiszámolja, MELYIK hangra és MENNYIT kell húzni.
 *
 * Expo-mentes, determinisztikus, teljesen tesztelhető.
 */

export const A4_FREQ = 440;
export const A4_MIDI = 69;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// ── Konverziók ────────────────────────────────────────────────────────────────

export function midiToFreq(midi: number): number {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** frekvencia → (tört) MIDI-hangszám; hz<=0 esetén -Infinity (unvoiced). */
export function freqToMidi(hz: number): number {
  if (hz <= 0) {
    return -Infinity;
  }
  return A4_MIDI + 12 * Math.log2(hz / A4_FREQ);
}

/** MIDI (egész) → hangnév (A4=69 konvenció, C4=60). */
export function midiToNoteName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/** hangnév („A4", „C#3", „Db5") → MIDI, vagy null ha érvénytelen. */
export function noteNameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) {
    return null;
  }
  const base = LETTER_PC[m[1].toUpperCase()];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = parseInt(m[3], 10);
  return base + acc + (octave + 1) * 12;
}

/** cent-eltérés f1→f2 (100 cent = 1 félhang). */
export function centsBetween(f1: number, f2: number): number {
  if (f1 <= 0 || f2 <= 0) {
    return 0;
  }
  return Math.round(1200 * Math.log2(f2 / f1) * 10) / 10;
}

// ── Skálák ────────────────────────────────────────────────────────────────────

export type ScaleName =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'dorian'
  | 'phrygian'
  | 'mixolydian'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'chromatic';

/** a skála félhang-lépcsői a gyökértől (0–11). */
export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface MusicKey {
  /** gyökér pitch-class 0–11 (C=0) VAGY hangnév-gyökér a `keyFromName`-mel */
  root: number;
  scale: ScaleName;
}

/** hangnév-gyökérből kulcs (pl. `keyFromName('A','naturalMinor')`). */
export function keyFromName(rootName: string, scale: ScaleName): MusicKey | null {
  const midi = noteNameToMidi(rootName + '0');
  if (midi === null) {
    return null;
  }
  return { root: ((midi % 12) + 12) % 12, scale };
}

/** a kulcs összes skálahangja MIDI-ben (0–127), növekvő sorrendben. */
export function scaleMidiSequence(key: MusicKey): number[] {
  const steps = SCALES[key.scale];
  const out: number[] = [];
  for (let octave = 0; octave <= 10; octave++) {
    for (const s of steps) {
      const midi = key.root + s + 12 * octave;
      if (midi >= 0 && midi <= 127) {
        out.push(midi);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** A (tört) MIDI legközelebbi skálahangja (egész MIDI). Döntetlennél lefelé. */
export function snapMidiToScale(midi: number, key: MusicKey): number {
  const seq = scaleMidiSequence(key);
  let best = seq[0];
  let bestDist = Infinity;
  for (const n of seq) {
    const d = Math.abs(n - midi);
    if (d < bestDist - 1e-9) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

// ── Pitch-correction terv (auto-tune) ────────────────────────────────────────

export interface PitchPoint {
  time: number;
  /** detektált alaphang (Hz); <=0 = unvoiced (nincs hang) */
  hz: number;
}

export interface CorrectionPoint {
  time: number;
  hz: number;
  /** a skála cél-hangja (Hz); unvoiced-nál 0 */
  targetHz: number;
  /** a ténylegesen alkalmazandó hang (Hz) a strength-blend után */
  correctedHz: number;
  /** az elmozdulás centben (hz → correctedHz) */
  shiftCents: number;
}

export interface CorrectionOptions {
  /** 0…1: mennyire húzza a cél-hangra (1 = teljes auto-tune, 0 = változatlan) */
  strength?: number;
}

/**
 * Pitch-correction terv: minden zöngés ponthoz a skála legközelebbi hangja a cél;
 * a `strength` a log-frekvencia (félhang) térben blendel az eredeti és a cél
 * között. Az unvoiced pontok (hz<=0) változatlanul átmennek.
 */
export function pitchCorrectionPlan(points: PitchPoint[], key: MusicKey, opts: CorrectionOptions = {}): CorrectionPoint[] {
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  return points.map((p) => {
    if (p.hz <= 0) {
      return { time: p.time, hz: p.hz, targetHz: 0, correctedHz: p.hz, shiftCents: 0 };
    }
    const midiFloat = freqToMidi(p.hz);
    const targetMidi = snapMidiToScale(midiFloat, key);
    const correctedMidi = midiFloat + (targetMidi - midiFloat) * strength;
    const targetHz = midiToFreq(targetMidi);
    const correctedHz = midiToFreq(correctedMidi);
    return {
      time: p.time,
      hz: p.hz,
      targetHz: Math.round(targetHz * 100) / 100,
      correctedHz: Math.round(correctedHz * 100) / 100,
      shiftCents: centsBetween(p.hz, correctedHz),
    };
  });
}

// ── Diatonikus harmónia ──────────────────────────────────────────────────────

/**
 * Diatonikus lépés: a `midi` hangot a skálán `steps` fokkal elmozdítja (a hang
 * előbb a skálára illesztődik). +2 = terc, +4 = kvint, +7 = oktáv (7-fokú skálán).
 * A tartomány szélén a legszélső skálahangra korlátoz.
 */
export function diatonicStep(midi: number, steps: number, key: MusicKey): number {
  const seq = scaleMidiSequence(key);
  const snapped = snapMidiToScale(midi, key);
  const idx = seq.indexOf(snapped);
  const target = Math.max(0, Math.min(seq.length - 1, idx + steps));
  return seq[target];
}

/** Egy hang harmónia-párja (diatonikus interval fölött/alatt) MIDI-ben. */
export function harmonize(midi: number, key: MusicKey, steps: number): number {
  return diatonicStep(midi, steps, key);
}

/**
 * Harmónia-szólam egy detektált dallamhoz: minden zöngés ponthoz a diatonikus
 * `steps`-fokkal fentebbi (vagy lentebbi) hang frekvenciája. Az unvoiced pontok
 * átmennek (hz<=0).
 */
export function harmonyLine(points: PitchPoint[], key: MusicKey, steps: number): PitchPoint[] {
  return points.map((p) => {
    if (p.hz <= 0) {
      return { time: p.time, hz: p.hz };
    }
    const midi = harmonize(freqToMidi(p.hz), key, steps);
    return { time: p.time, hz: Math.round(midiToFreq(midi) * 100) / 100 };
  });
}
