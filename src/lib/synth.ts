/**
 * 🎹 Zenekészítő mag (AUDIOT §5) — pure + tesztelt.
 *
 * A piano-roll hangjegyeinek (SynthNote) modellje + rács-műveletei + idővonal-időzítése.
 * A hangmagasság ↔ frekvencia a `pitch.ts`-ből (midiToFreq). A hangjegyekből a worker
 * (`server/synth.js`) generál hangot (sine/square/triangle/saw + ADSR), de az IDŐZÍTÉS és a
 * rács-logika itt él, hogy önmagában tesztelhető legyen. Expo-mentes.
 */
import { midiToFreq, midiToNoteName, snapMidiToScale, type MusicKey } from '@/lib/pitch';

export type SynthWave = 'sine' | 'square' | 'triangle' | 'sawtooth';

export interface SynthNote {
  id: string;
  /** MIDI-hangszám (C4=60, A4=69) */
  midi: number;
  /** kezdet ütemben (beat, 0-alapú) */
  startBeat: number;
  /** hossz ütemben (beat) */
  lengthBeats: number;
  /** 1–127 (hiányzó = 100) */
  velocity?: number;
}

/** A piano-roll alap hangmagasság-tartománya (C3…C6, 3 oktáv). */
export const DEFAULT_LOW_MIDI = 48; // C3
export const DEFAULT_HIGH_MIDI = 84; // C6

/** A hangmagasság-sorok (fentről lefelé: magas → mély), a rács rajzolásához. */
export function pitchRows(lowMidi = DEFAULT_LOW_MIDI, highMidi = DEFAULT_HIGH_MIDI): number[] {
  const rows: number[] = [];
  for (let m = highMidi; m >= lowMidi; m--) {
    rows.push(m);
  }
  return rows;
}

/** Fekete billentyű-e (a rács sávozásához). */
export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export const noteLabel = midiToNoteName;
export const noteFreq = midiToFreq;

const round = (n: number): number => Math.round(n * 1000) / 1000;
const secPerBeat = (bpm: number): number => 60 / (bpm > 0 ? bpm : 120);

/** Hang kezdete mp-ben a BPM szerint. */
export function noteStartSec(note: SynthNote, bpm: number): number {
  return round(Math.max(0, note.startBeat) * secPerBeat(bpm));
}
/** Hang hossza mp-ben. */
export function noteDurationSec(note: SynthNote, bpm: number): number {
  return round(Math.max(0, note.lengthBeats) * secPerBeat(bpm));
}
/** Hang vége mp-ben. */
export function noteEndSec(note: SynthNote, bpm: number): number {
  return round(noteStartSec(note, bpm) + noteDurationSec(note, bpm));
}

/** A teljes szekvencia hossza mp-ben (a legkésőbbi hang vége). */
export function synthDurationSec(notes: SynthNote[], bpm: number): number {
  return notes.reduce((max, n) => Math.max(max, noteEndSec(n, bpm)), 0);
}

/** Van-e már hang ezen a (midi, startBeat) cellán? */
export function noteAt(notes: SynthNote[], midi: number, startBeat: number): SynthNote | undefined {
  return notes.find((n) => n.midi === midi && Math.abs(n.startBeat - startBeat) < 1e-6);
}

/**
 * Rács-cellára koppintás: ha van ott hang → törli (toggle-off), különben hozzáad egy
 * `lengthBeats` hosszút. Tiszta → új tömböt ad vissza.
 */
export function toggleNote(
  notes: SynthNote[],
  midi: number,
  startBeat: number,
  makeId: () => string,
  lengthBeats = 1,
  velocity = 100
): SynthNote[] {
  const existing = noteAt(notes, midi, startBeat);
  if (existing) {
    return notes.filter((n) => n.id !== existing.id);
  }
  return [...notes, { id: makeId(), midi, startBeat, lengthBeats, velocity }];
}

/** a piano roll három velocity-szintje: halk · közepes (alap) · erős */
export const NOTE_VELOCITIES = [50, 100, 127] as const;

/** egy hang velocity-jének léptetése: közepes → erős → halk → közepes (immutábilis) */
export function cycleNoteVelocity(notes: SynthNote[], id: string): SynthNote[] {
  return notes.map((n) => {
    if (n.id !== id) return n;
    const cur = n.velocity ?? 100;
    return { ...n, velocity: cur >= 127 ? 50 : cur >= 100 ? 127 : 100 };
  });
}

// ── 🎹 S11 (MU2): hanghossz koppintással, rács-felbontás, skála, oktáv-görgetés ──────────────────

/** a rács lépése ütemrészben: negyed (1 lépés/ütem), nyolcad (2), tizenhatod (4), triola (3) */
export type StepsPerBeat = 1 | 2 | 4 | 3;
export const STEP_GRIDS: readonly StepsPerBeat[] = [1, 2, 4, 3];

/** a rács egy lépésének hossza ütemben */
export const stepBeats = (stepsPerBeat: StepsPerBeat): number => 1 / stepsPerBeat;

const EPS = 1e-6;

/** az a hang ezen a soron, amelynek a [kezdet, vég) ablaka lefedi az ütem-pozíciót */
export function noteCovering(notes: SynthNote[], midi: number, beat: number): SynthNote | undefined {
  return notes.find((n) => n.midi === midi && beat > n.startBeat - EPS && beat < n.startBeat + n.lengthBeats - EPS);
}

/**
 * Rács-cellára koppintás a hanghossz-szabállyal (érintős, húzás nélkül — PRO-MUSIC §alapszabály):
 *  • a hang KEZDŐ celláján → a hang törlése (toggle-off, mint eddig);
 *  • a hang BELSEJÉBEN → a hang itt végződik (rövidül);
 *  • a hang VÉGE utáni (szomszédos) cellán → a hang egy lépéssel hosszabbodik;
 *  • különben → új, egy lépés hosszú hang a választott erősséggel.
 * Tiszta: új tömböt ad.
 */
export function tapCell(
  notes: SynthNote[],
  midi: number,
  beat: number,
  stepsPerBeat: StepsPerBeat,
  makeId: () => string,
  velocity = 100
): SynthNote[] {
  const step = stepBeats(stepsPerBeat);
  const starting = noteAt(notes, midi, beat);
  if (starting) return notes.filter((n) => n.id !== starting.id);
  const inside = noteCovering(notes, midi, beat);
  if (inside) {
    return notes.map((n) => (n.id === inside.id ? { ...n, lengthBeats: Math.max(step, beat - n.startBeat) } : n));
  }
  const ending = notes.find((n) => n.midi === midi && Math.abs(n.startBeat + n.lengthBeats - beat) < EPS);
  if (ending) {
    return notes.map((n) => (n.id === ending.id ? { ...n, lengthBeats: n.lengthBeats + step } : n));
  }
  return [...notes, { id: makeId(), midi, startBeat: beat, lengthBeats: step, velocity }];
}

/** a hang a skálában van-e (a `pitch.ts` kulcsával) */
export function inScale(midi: number, key: MusicKey | null): boolean {
  return !key || snapMidiToScale(midi, key) === midi;
}

/** a piano roll teljes hangmagasság-tartománya: C1 … C7 (oktáv-görgetés) */
export const OCTAVE_MIN_MIDI = 24; // C1
export const OCTAVE_MAX_MIDI = 96; // C7

/** a látható ablak eltolása egy oktávval, a C1–C7 határokon belül (az ablak hossza marad) */
export function shiftOctave(lowMidi: number, highMidi: number, dir: 1 | -1): { lowMidi: number; highMidi: number } {
  const span = highMidi - lowMidi;
  const low = Math.max(OCTAVE_MIN_MIDI, Math.min(OCTAVE_MAX_MIDI - span, lowMidi + 12 * dir));
  return { lowMidi: low, highMidi: low + span };
}

/** Hang törlése id alapján. */
export function removeNote(notes: SynthNote[], id: string): SynthNote[] {
  return notes.filter((n) => n.id !== id);
}

/** Üres-e (nincs lejátszható hang). */
export function isEmpty(notes: SynthNote[]): boolean {
  return notes.length === 0;
}
