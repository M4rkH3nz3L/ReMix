/**
 * 🎤 AUDIO-PROD V3.2 — ének-hangolás hangonként (döntés 2026-11-14): a telefon felismeri a dallamot (YIN),
 * hangokra bontja, és hangonként ÁLLANDÓ eltolással a skálára igazítja (vagy a hangnem szerinti harmónia-hangot
 * állítja elő); a tolás a formánstartó tolóval, a darabok rövid, egyenletes-teljesítményű áttűnéssel kerülnek
 * vissza. Pure, expo-mentes: a felismerés, a terv és az összeillesztés; a tényleges tolás a kliensé.
 */
import { fft } from '@/lib/denoise';
import { diatonicStep, freqToMidi, snapMidiToScale, type MusicKey } from '@/lib/pitch';

/** az elemzés mintavétele (44,1 kHz / 4) és paraméterei */
export const ANALYSIS_DECIM = 4;
const W = 768;
const FFT_N = 2048;
const F_MIN = 70;
const F_MAX = 1000;
const YIN_THRESHOLD = 0.15;

export interface PitchFrame {
  /** a keret közepe (mp) */
  time: number;
  /** alaphang (Hz); 0 = zöngétlen */
  hz: number;
}

/** YIN-alapú hangmagasság-sor (`hopSec` lépésközzel), FFT-s keresztkorrelációval */
export function pitchTrack(mono: Float32Array, sr: number, hopSec = 0.02): PitchFrame[] {
  // tizedelés 4-es átlagolással (egyszerű aluláteresztő) → ~11 kHz
  const asr = sr / ANALYSIS_DECIM;
  const n = Math.floor(mono.length / ANALYSIS_DECIM);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * ANALYSIS_DECIM;
    x[i] = (mono[k] + mono[k + 1] + mono[k + 2] + mono[k + 3]) * 0.25;
  }
  const tauMin = Math.floor(asr / F_MAX);
  const tauMax = Math.ceil(asr / F_MIN);
  const hop = Math.max(1, Math.round(hopSec * asr));
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  const out: PitchFrame[] = [];
  const ar = new Float64Array(FFT_N);
  const ai = new Float64Array(FFT_N);
  const br = new Float64Array(FFT_N);
  const bi = new Float64Array(FFT_N);
  const d = new Float64Array(tauMax + 1);
  let peakEnergy = 0;
  for (let s = 0; s + W + tauMax < n; s += hop) peakEnergy = Math.max(peakEnergy, (sq[s + W] - sq[s]) / W);
  for (let s = 0; s + W + tauMax < n; s += hop) {
    const time = (s + W / 2) / asr;
    const e0 = sq[s + W] - sq[s];
    if (e0 / W < peakEnergy * 1e-3 || e0 < 1e-9) {
      out.push({ time, hz: 0 });
      continue;
    }
    // r(τ) = Σ x[s+j]·x[s+j+τ], j < W — az a = x[s..s+W) és b = x[s..s+W+τmax) keresztkorrelációja
    ar.fill(0);
    ai.fill(0);
    br.fill(0);
    bi.fill(0);
    for (let j = 0; j < W; j++) ar[j] = x[s + j];
    for (let j = 0; j < W + tauMax; j++) br[j] = x[s + j];
    fft(ar, ai, false);
    fft(br, bi, false);
    for (let k = 0; k < FFT_N; k++) {
      const re = ar[k] * br[k] + ai[k] * bi[k];
      const im = ar[k] * bi[k] - ai[k] * br[k];
      ar[k] = re;
      ai[k] = im;
    }
    fft(ar, ai, true);
    // a különbség-függvény és a normalizált változata (CMNDF) τ = 1…τmax
    d[0] = 1;
    let cum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      const r = ar[tau] / FFT_N;
      const et = sq[s + tau + W] - sq[s + tau];
      const diff = e0 + et - 2 * r;
      cum += diff;
      d[tau] = cum > 0 ? (diff * tau) / cum : 1;
    }
    let found = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < YIN_THRESHOLD) {
        found = tau;
        break;
      }
    }
    if (found < 0) {
      out.push({ time, hz: 0 });
      continue;
    }
    // a lokális minimumig, majd parabolikus finomítás
    let tau = found;
    while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
    const a = d[tau - 1];
    const b = d[tau];
    const c = tau + 1 <= tauMax ? d[tau + 1] : b;
    const denom = a - 2 * b + c;
    const frac = Math.abs(denom) > 1e-12 ? (0.5 * (a - c)) / denom : 0;
    out.push({ time, hz: asr / (tau + Math.max(-0.5, Math.min(0.5, frac))) });
  }
  return out;
}

export interface NoteSegment {
  start: number;
  end: number;
  /** a hang (tört) MIDI-értéke: a szegmens mediánja */
  midi: number;
}

/** a zöngés keretek hangokra bontva: egy hang addig tart, amíg a magasság ±`tolSemis`-en belül marad */
export function noteSegments(frames: readonly PitchFrame[], hopSec = 0.02, minSec = 0.08, tolSemis = 0.6): NoteSegment[] {
  const out: NoteSegment[] = [];
  let cur: number[] = [];
  let start = 0;
  const flush = (endTime: number) => {
    if (cur.length * hopSec >= minSec) {
      const sorted = [...cur].sort((p, q) => p - q);
      out.push({ start, end: endTime, midi: sorted[sorted.length >> 1] });
    }
    cur = [];
  };
  for (const f of frames) {
    if (f.hz <= 0) {
      if (cur.length) flush(f.time - hopSec / 2);
      continue;
    }
    const m = freqToMidi(f.hz);
    if (cur.length) {
      const mean = cur.reduce((s, v) => s + v, 0) / cur.length;
      if (Math.abs(m - mean) > tolSemis) flush(f.time - hopSec / 2);
    }
    if (!cur.length) start = f.time - hopSec / 2;
    cur.push(m);
  }
  if (cur.length) flush((frames[frames.length - 1]?.time ?? 0) + hopSec / 2);
  return out;
}

export interface ShiftSegment {
  start: number;
  end: number;
  /** a hang eltolása centben */
  cents: number;
}

/** skálára igazítás: hangonként a legközelebbi skálahang felé, `strength` aránnyal (3 centnél kisebbet kihagy) */
export function tunePlan(segments: readonly NoteSegment[], key: MusicKey, strength = 1): ShiftSegment[] {
  const k = Math.max(0, Math.min(1, strength));
  return segments
    .map((s) => ({ start: s.start, end: s.end, cents: Math.round((snapMidiToScale(s.midi, key) - s.midi) * k * 100) }))
    .filter((s) => Math.abs(s.cents) >= 3);
}

/** harmónia: hangonként a hangnem szerinti `steps` fokkal arrébb lévő hang, a skálára hangolva */
export function harmonyPlan(segments: readonly NoteSegment[], key: MusicKey, steps: number): ShiftSegment[] {
  return segments.map((s) => ({ start: s.start, end: s.end, cents: Math.round((diatonicStep(s.midi, steps, key) - s.midi) * 100) }));
}

/** áttűnés (mp) a darabok szélein */
export const TUNE_XFADE_SEC = 0.02;

/**
 * A tolt darabok visszaillesztése: a `base` (az eredeti, vagy harmóniánál csend) és a darab egyenletes-
 * teljesítményű áttűnéssel a darab első és utolsó `xfade` mintáján. A darabok mintában adottak (`start`).
 */
export function assembleShifted(base: Float32Array[], pieces: readonly { start: number; data: Float32Array[] }[], xfade: number): Float32Array[] {
  const out = base.map((ch) => Float32Array.from(ch));
  for (const p of pieces) {
    const len = p.data[0].length;
    for (let c = 0; c < out.length; c++) {
      const dst = out[c];
      const src = p.data[c] ?? p.data[0];
      const orig = base[c];
      for (let i = 0; i < len; i++) {
        const at = p.start + i;
        if (at < 0 || at >= dst.length) continue;
        const edge = Math.min(i, len - 1 - i);
        const w = edge >= xfade ? 1 : Math.sin(((edge + 0.5) / xfade) * (Math.PI / 2));
        const keep = Math.sqrt(Math.max(0, 1 - w * w));
        dst[at] = src[i] * w + orig[at] * keep;
      }
    }
  }
  return out;
}
