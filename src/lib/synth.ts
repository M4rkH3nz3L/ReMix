/**
 * 🎹 Zenekészítő mag (AUDIOT §5) — pure + tesztelt.
 *
 * A piano-roll hangjegyeinek (SynthNote) modellje + rács-műveletei + idővonal-időzítése.
 * A hangmagasság ↔ frekvencia a `pitch.ts`-ből (midiToFreq). A hangjegyekből a worker
 * (`server/synth.js`) generál hangot (sine/square/triangle/saw + ADSR), de az IDŐZÍTÉS és a
 * rács-logika itt él, hogy önmagában tesztelhető legyen. Expo-mentes.
 */
import { midiToFreq, midiToNoteName } from '@/lib/pitch';

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

/** Hang törlése id alapján. */
export function removeNote(notes: SynthNote[], id: string): SynthNote[] {
  return notes.filter((n) => n.id !== id);
}

/** Üres-e (nincs lejátszható hang). */
export function isEmpty(notes: SynthNote[]): boolean {
  return notes.length === 0;
}
