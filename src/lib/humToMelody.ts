/**
 * 🎵 V8 (AUDIO-PROD) — dúdolásból dallam (expo-mentes, tiszta mag).
 *
 * Döntés 2026-11-15: az első telefonos „AI-zene” funkció modell NÉLKÜL — a meglévő YIN hangmagasság-követés
 * (`vocalTune.pitchTrack` + `noteSegments`) hangjaiból hangjegyek: a projekt tempóján a rácsra (alapból 1/16)
 * igazítva, opcionálisan a hangnemre húzva, oktávval eltolhatóan. Az eredmény szerkeszthető szinti-minta (a
 * piano rollban) — a dúdolás klipje alatt, ugyanott kezdődve; egy undo.
 */
import { snapMidiToScale, type MusicKey } from '@/lib/pitch';
import type { SynthNote } from '@/lib/synth';
import type { NoteSegment } from '@/lib/vocalTune';

export interface HumOptions {
  bpm: number;
  /** a rács beatben (0,25 = tizenhatod) */
  grid?: number;
  /** hangnemre húzás (hiányzó = kromatikus, a legközelebbi félhang) */
  key?: MusicKey;
  /** oktáv-eltolás (pl. −1: a dúdolt dallam basszusnak) */
  octave?: number;
  /** a forrás eleje (s) a klipben — az előtte lévő hangok kimaradnak, a többi ehhez képest */
  fromSec?: number;
  toSec?: number;
}

export const HUM_MAX_NOTES = 1024;

/** a hangok → rácsra igazított, átfedés nélküli hangjegyek (a kezdet a `fromSec`-hez képest, beatben) */
export function melodyFromSegments(segments: readonly NoteSegment[], opts: HumOptions): SynthNote[] {
  const grid = opts.grid ?? 0.25;
  const bps = opts.bpm / 60;
  const from = opts.fromSec ?? 0;
  const to = opts.toSec ?? Number.POSITIVE_INFINITY;
  const q = (sec: number) => Math.round(((sec - from) * bps) / grid) * grid;
  const raw: { midi: number; a: number; b: number }[] = [];
  for (const s of segments) {
    if (s.end <= from || s.start >= to) continue;
    let midi = Math.round(s.midi);
    if (opts.key) midi = snapMidiToScale(midi, opts.key);
    midi += 12 * (opts.octave ?? 0);
    if (midi < 0 || midi > 127) continue;
    const a = q(Math.max(from, s.start));
    const b = Math.max(a + grid, q(Math.min(to, s.end)));
    raw.push({ midi, a, b });
  }
  raw.sort((x, y) => x.a - y.a);
  // a rácsra igazítás után összeérő azonos hangok egybe; az átfedő előző hang a következő kezdeténél ér véget
  const merged: { midi: number; a: number; b: number }[] = [];
  for (const n of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.a <= prev.b + 1e-9) {
      prev.b = Math.max(prev.b, n.b);
      continue;
    }
    if (prev && n.a < prev.b) {
      if (n.a <= prev.a) continue; // ugyanarra a rácspontra eső rövidebb hang: az első marad
      prev.b = n.a;
    }
    merged.push({ ...n });
  }
  return merged.slice(0, HUM_MAX_NOTES).map((n, i) => ({ id: `hum${i}`, midi: n.midi, startBeat: n.a, lengthBeats: +(n.b - n.a).toFixed(6) }));
}

/** a minta hossza ütemben (4/4, egész ütemre kerekítve felfelé, legalább 1) */
export function melodyBars(notes: readonly SynthNote[], beatsPerBar = 4): number {
  const end = notes.reduce((m, n) => Math.max(m, n.startBeat + n.lengthBeats), 0);
  return Math.max(1, Math.ceil(end / beatsPerBar - 1e-9));
}
