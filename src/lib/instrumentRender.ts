import { Biquad, highpass, Limiter, lowpass } from '@/lib/audioDsp';
import type { DrumHit, DrumVoice } from '@/lib/drums';
import { midiToFreq } from '@/lib/pitch';
import type { SynthNote, SynthWave } from '@/lib/synth';

/**
 * 🎹🥁🎛️ Hangszerek a telefonon (offline-first) — tiszta mag. A szerver ffmpeg-láncainak
 * (`server/synth.js`, `drums.js`, `sampler.js`) tükre: ugyanazok a hullámformák, burkolók,
 * szűrők (RBJ-biquad = az ffmpeg matematikája) és a végén a 0,95-ös limiter. A zaj
 * determinisztikus (mulberry32), így ugyanaz a minta mindig ugyanúgy szól. Sztereó kimenet
 * (a két csatorna azonos — a szerver `aformat=stereo`-ja).
 */

export const INSTRUMENT_SR = 44100;
type Stereo = [Float32Array, Float32Array];

/** egy hangjegy hullámformája (a szerver `waveExpr`-e; a szinusz is 0,5 amplitúdó) */
export function waveSample(wave: SynthWave, f: number, t: number): number {
  switch (wave) {
    case 'square':
      return 0.45 * Math.sign(Math.sin(2 * Math.PI * f * t));
    case 'triangle':
      return 0.5 * (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t));
    case 'sawtooth':
      return 0.45 * (2 * (f * t - Math.floor(0.5 + f * t)));
    default:
      return 0.5 * Math.sin(2 * Math.PI * f * t);
  }
}

const finish = (l: Float32Array, sr: number): Stereo => {
  const r = Float32Array.from(l);
  new Limiter(0.95, 50, sr).processStereo(l, r);
  return [l, r];
};

/** a hangjegyek hanggá (a hossz a legkésőbbi hang vége) */
export function renderSynthPcm(notes: SynthNote[], wave: SynthWave, bpm: number, sr = INSTRUMENT_SR): Stereo {
  const spb = 60 / (bpm > 0 ? bpm : 120);
  const list = notes.slice(0, 400);
  const total = list.reduce((m, n) => Math.max(m, Math.max(0, n.startBeat) * spb + Math.max(0.05, (n.lengthBeats || 1) * spb)), 0);
  const out = new Float32Array(Math.ceil(total * sr));
  for (const n of list) {
    const f = midiToFreq(Math.max(0, Math.min(127, Math.round(n.midi))));
    const start = Math.max(0, n.startBeat) * spb;
    const dur = Math.max(0.05, (n.lengthBeats || 1) * spb);
    const vel = Math.max(0, Math.min(1, (n.velocity || 100) / 127));
    const atk = Math.min(0.008, dur / 4);
    const rel = Math.min(0.06, dur / 3);
    const relSt = Math.max(0, dur - rel);
    const s0 = Math.round(start * sr);
    const len = Math.round(dur * sr);
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const t = i / sr;
      const env = Math.min(1, t / atk) * (t > relSt ? Math.max(0, 1 - (t - relSt) / rel) : 1);
      out[s0 + i] += waveSample(wave, f, t) * env * vel;
    }
  }
  return finish(out, sr);
}

/** determinisztikus fehér zaj [-a, a] */
function noise(seed: number, a: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * a;
  };
}

/** ffmpeg `bandpass=f:width_type=h:w` (csg=0: a csúcs 0 dB) */
function bandpass(f: number, width: number, sr: number): Biquad {
  const w0 = (2 * Math.PI * f) / sr;
  const alpha = Math.sin(w0) / (2 * (f / width));
  return new Biquad({ b0: alpha, b1: 0, b2: -alpha, a0: 1 + alpha, a1: -2 * Math.cos(w0), a2: 1 - alpha });
}

/** egy dob-hang (a szerver `voiceSource`-a), mono; `seed`: a zaj */
export function drumVoicePcm(voice: DrumVoice, sr = INSTRUMENT_SR, seed = 1): Float32Array {
  const make = (sec: number, fn: (t: number, i: number) => number) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => fn(i / sr, i));
  const fadeOut = (t: number, st: number, d: number) => (t < st ? 1 : Math.max(0, 1 - (t - st) / d));
  const filt = (x: Float32Array, fs: Biquad[]) => {
    const r = Float32Array.from(x);
    for (const f of fs) f.processStereo(x, r);
    return x;
  };
  switch (voice) {
    case 'kick':
      return make(0.3, (t) => Math.exp(-t * 18) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 30)) * t));
    case 'snare': {
      const n = noise(seed, 0.7);
      const x = filt(make(0.2, () => n()), [highpass(1500, sr), lowpass(8000, sr)]);
      return x.map((v, i) => v * fadeOut(i / sr, 0.005, 0.19));
    }
    case 'hihat': {
      const n = noise(seed + 1, 0.5);
      const x = filt(make(0.06, () => n()), [highpass(8000, sr)]);
      return x.map((v, i) => v * fadeOut(i / sr, 0, 0.06));
    }
    default: {
      const n = noise(seed + 2, 0.6);
      const x = filt(make(0.13, () => n()), [bandpass(1200, 1200, sr)]);
      return x.map((v, i) => v * fadeOut(i / sr, 0.01, 0.12));
    }
  }
}

/** a minta a megadott hosszra (loophoz: a rács hossza) — csenddel kitöltve, a végén levágva */
export function padTo(stereo: Float32Array[], sec: number, sr = INSTRUMENT_SR): Float32Array[] {
  const n = Math.round(sec * sr);
  return stereo.map((ch) => {
    const out = new Float32Array(n);
    out.set(ch.subarray(0, n));
    return out;
  });
}

/** egy 16-od lépés hossza (kerekítés nélkül — a szerver `stepSec`-e) */
const stepLen = (bpm: number) => 60 / (bpm > 0 ? bpm : 120) / 4;
/** a rács teljes hossza mp-ben (ms-ra kerekítve, mint a szerver) */
export const gridSec = (bars: number, bpm: number) => Math.round(Math.max(1, Math.floor(bars)) * 16 * stepLen(bpm) * 1000) / 1000;

/** a hangok a lépésekre helyezve, a rács hosszára vágva */
function placeOnGrid(hits: { step: number; pcm: Float32Array[]; gain: number }[], bars: number, bpm: number, sr: number): Stereo {
  const n = Math.round(gridSec(bars, bpm) * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (const h of hits) {
    const s0 = Math.round(Math.max(0, h.step) * stepLen(bpm) * sr);
    const a = h.pcm[0];
    const b = h.pcm[1] ?? h.pcm[0];
    for (let i = 0; i < a.length && s0 + i < n; i++) {
      l[s0 + i] += a[i] * h.gain;
      r[s0 + i] += b[i] * h.gain;
    }
  }
  new Limiter(0.95, 50, sr).processStereo(l, r);
  return [l, r];
}

/** a dob-minta hanggá (ütésenként azonos hang — a minta ismételhető, mint egy gép) */
export function renderDrumsPcm(hits: DrumHit[], bars: number, bpm: number, sr = INSTRUMENT_SR): Stereo {
  const cache = new Map<DrumVoice, Float32Array>();
  const voice = (v: DrumVoice) => cache.get(v) ?? cache.set(v, drumVoicePcm(v, sr)).get(v)!;
  return placeOnGrid(
    hits.slice(0, 512).map((h) => ({ step: h.step, pcm: [voice(h.voice)], gain: 0.9 })),
    bars,
    bpm,
    sr
  );
}

/** a sampler: a minta (dekódolt csatornák) a lépésekre */
export function renderSamplerPcm(sample: Float32Array[], steps: number[], bars: number, bpm: number, sr = INSTRUMENT_SR): Stereo {
  return placeOnGrid(steps.slice(0, 256).map((step) => ({ step, pcm: sample, gain: 1 })), bars, bpm, sr);
}
