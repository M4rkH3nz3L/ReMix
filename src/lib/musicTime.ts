import type { BeatGrid } from '@/lib/beats';

/**
 * 🎵 Zenei időzítés-mag (S-MUSIC — MASTER §5) — a DAW-időrács tiszta matematikája:
 * BPM + ütemmutató + **tempo-map** ↔ másodperc ↔ **bars/beats**, beat/bar-rács
 * generálás, **quantize** (subdivision + strength + swing) és **loop-régiók**.
 *
 * Kiegészíti a [beats.ts](./beats) DETEKTÁLT beat-rácsát (audió → grid): ez a
 * VEZÉRELT időzítés (a projekt tempója), amiből a rács és a kvantálás számol.
 * Tiszta, expo-mentes, determinisztikus — a nehéz DSP (time-stretch) a workeré.
 */

/** MIDI-szabvány felbontás: 960 tick / beat (a bars/beats/tick megjelenítéshez). */
export const TICKS_PER_BEAT = 960;

export interface TimeSignature {
  /** ütemenkénti beat-szám (a számláló), pl. 4 a 4/4-ben */
  beatsPerBar: number;
  /** a beat-egység (a nevező), pl. 4 = negyed, 8 = nyolcad */
  beatUnit: number;
}

/** Tempo-szegmens: ettől a beat-pozíciótól érvényes a BPM (az első atBeat=0). */
export interface TempoSegment {
  atBeat: number;
  bpm: number;
}

export interface MusicTiming {
  timeSignature: TimeSignature;
  /** tempo-map beat szerint növekvő sorrendben; a [0].atBeat mindig 0 */
  tempoMap: TempoSegment[];
}

export interface BarsBeats {
  /** 1-alapú ütem */
  bar: number;
  /** 1-alapú beat az ütemen belül */
  beat: number;
  /** 0…TICKS_PER_BEAT-1 a beaten belül */
  tick: number;
}

const DEFAULT_TS: TimeSignature = { beatsPerBar: 4, beatUnit: 4 };

/** Egyszerű, állandó-tempójú időzítés. */
export function createTiming(bpm: number, timeSignature: TimeSignature = DEFAULT_TS): MusicTiming {
  return { timeSignature, tempoMap: [{ atBeat: 0, bpm: bpm > 0 ? bpm : 120 }] };
}

/** rendezett, érvényes tempo-map (első atBeat=0, pozitív BPM-ek). */
function normalizedMap(timing: MusicTiming): TempoSegment[] {
  const map = [...timing.tempoMap]
    .filter((s) => s.bpm > 0)
    .sort((a, b) => a.atBeat - b.atBeat);
  if (map.length === 0 || map[0].atBeat !== 0) {
    return [{ atBeat: 0, bpm: map[0]?.bpm ?? 120 }, ...map.filter((s) => s.atBeat > 0)];
  }
  return map;
}

/** a szegmens-határok abszolút ideje (mp) — a konverziók előszámítása. */
function segmentTimes(map: TempoSegment[]): number[] {
  const times = [0];
  for (let i = 1; i < map.length; i++) {
    const beats = map[i].atBeat - map[i - 1].atBeat;
    times.push(times[i - 1] + beats * (60 / map[i - 1].bpm));
  }
  return times;
}

/** Egy beat-pozíció abszolút ideje (mp), a tempo-mapen integrálva. */
export function timeAtBeat(timing: MusicTiming, beat: number): number {
  const map = normalizedMap(timing);
  const times = segmentTimes(map);
  let k = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i].atBeat <= beat) {
      k = i;
    } else {
      break;
    }
  }
  return times[k] + (beat - map[k].atBeat) * (60 / map[k].bpm);
}

/** Egy időpont (mp) beat-pozíciója, a tempo-mapen integrálva. */
export function beatAtTime(timing: MusicTiming, sec: number): number {
  const map = normalizedMap(timing);
  const times = segmentTimes(map);
  let k = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= sec) {
      k = i;
    } else {
      break;
    }
  }
  return map[k].atBeat + (sec - times[k]) * (map[k].bpm / 60);
}

// ── bars/beats ────────────────────────────────────────────────────────────────

export function beatToBarsBeats(timing: MusicTiming, beat: number): BarsBeats {
  const per = timing.timeSignature.beatsPerBar;
  const safe = Math.max(0, beat);
  const whole = Math.floor(safe);
  const frac = safe - whole;
  return {
    bar: Math.floor(whole / per) + 1,
    beat: (whole % per) + 1,
    tick: Math.round(frac * TICKS_PER_BEAT),
  };
}

export function barsBeatsToBeat(timing: MusicTiming, bb: BarsBeats): number {
  const per = timing.timeSignature.beatsPerBar;
  return (bb.bar - 1) * per + (bb.beat - 1) + bb.tick / TICKS_PER_BEAT;
}

/** Egy ütem (1-alapú) kezdetének ideje (mp). */
export function barToTime(timing: MusicTiming, bar: number): number {
  return timeAtBeat(timing, (bar - 1) * timing.timeSignature.beatsPerBar);
}

// ── Rács ────────────────────────────────────────────────────────────────────

/**
 * Rács-időpontok (mp) a `[fromSec, toSec]` ablakban. `subdivision`: 1 = beat,
 * 2 = nyolcad, 4 = tizenhatod (beatenkénti felosztás).
 */
export function beatGridTimes(timing: MusicTiming, fromSec: number, toSec: number, subdivision = 1): number[] {
  const step = 1 / Math.max(1, subdivision);
  const startBeat = Math.ceil(beatAtTime(timing, fromSec) / step) * step;
  const out: number[] = [];
  for (let b = startBeat; ; b += step) {
    const t = timeAtBeat(timing, b);
    if (t > toSec + 1e-9) {
      break;
    }
    if (t >= fromSec - 1e-9) {
      out.push(Math.round(t * 1e6) / 1e6);
    }
    if (out.length > 100000) {
      break; // biztonsági korlát
    }
  }
  return out;
}

/** Ütem-kezdetek (downbeat-ek) ideje (mp) a `[fromSec, toSec]` ablakban. */
export function barGridTimes(timing: MusicTiming, fromSec: number, toSec: number): number[] {
  const per = timing.timeSignature.beatsPerBar;
  const startBar = Math.max(1, Math.floor(beatAtTime(timing, fromSec) / per) + 1);
  const out: number[] = [];
  for (let bar = startBar; ; bar++) {
    const t = barToTime(timing, bar);
    if (t > toSec + 1e-9) {
      break;
    }
    if (t >= fromSec - 1e-9) {
      out.push(Math.round(t * 1e6) / 1e6);
    }
    if (out.length > 100000) {
      break;
    }
  }
  return out;
}

// ── Quantize ────────────────────────────────────────────────────────────────

export interface QuantizeOptions {
  /** rács-felosztás (1 = beat, 2 = nyolcad, 4 = tizenhatod) */
  subdivision?: number;
  /** 0…1: mennyire húzza a rácsra (1 = teljes, 0 = nincs mozgás) */
  strength?: number;
  /** 0…1: swing — a páratlan rács-pozíciók késleltetése (fél rács-lépésig) */
  swing?: number;
}

/** Egy beat-pozíció kvantálása (strength + swing) — a `quantizeTime` magja. */
export function quantizeBeat(beat: number, opts: QuantizeOptions = {}): number {
  const subdivision = Math.max(1, opts.subdivision ?? 1);
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  const swing = Math.max(0, Math.min(1, opts.swing ?? 0));
  const step = 1 / subdivision;
  const index = Math.round(beat / step);
  let target = index * step;
  if (swing > 0 && index % 2 === 1) {
    target += swing * step * 0.5; // a páros ütem 2. fele későbbre csúszik
  }
  return beat + (target - beat) * strength;
}

/** Egy időpont (mp) kvantálása a zenei rácsra — beat-térben számol, majd vissza. */
export function quantizeTime(timing: MusicTiming, sec: number, opts: QuantizeOptions = {}): number {
  const q = quantizeBeat(beatAtTime(timing, sec), opts);
  return Math.round(timeAtBeat(timing, q) * 1e6) / 1e6;
}

// ── Loop-régiók ───────────────────────────────────────────────────────────────

export interface LoopRegion {
  startSec: number;
  endSec: number;
  enabled: boolean;
}

/** Loop-régió ütem-tartományból (1-alapú startBar, `bars` hosszú). */
export function loopFromBars(timing: MusicTiming, startBar: number, bars: number): LoopRegion {
  const startSec = barToTime(timing, startBar);
  const endSec = barToTime(timing, startBar + Math.max(1, bars));
  return { startSec, endSec, enabled: true };
}

/** Egy lejátszófej-pozíció loopon belülre képezése (mp). Kikapcsolt/érvénytelen loopnál változatlan. */
export function loopWrap(loop: LoopRegion, sec: number): number {
  const len = loop.endSec - loop.startSec;
  if (!loop.enabled || len <= 0 || sec < loop.startSec) {
    return sec;
  }
  return loop.startSec + ((sec - loop.startSec) % len);
}

// ── Bridge: detektált BeatGrid → vezérelt időzítés ───────────────────────────

/** A detektált beat-rács BPM-jéből egyszerű, állandó-tempójú `MusicTiming`. */
export function timingFromBeatGrid(grid: Pick<BeatGrid, 'bpm'>, timeSignature: TimeSignature = DEFAULT_TS): MusicTiming {
  return createTiming(grid.bpm > 0 ? grid.bpm : 120, timeSignature);
}
