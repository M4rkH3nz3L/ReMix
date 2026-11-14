/**
 * 🎛️ AUDIO-PROD V2.3 — Sampler 2.0, pure, expo-mentes (a telefon süti; a `instrumentRender.ts` mintájára):
 *  - **kromatikus játék**: a minta az alaphangján (`rootMidi`) szól, a hangjegyek a hangmagasság arányában
 *    gyorsítva/lassítva olvassák (klasszikus sampler — a hangmagassággal a hossz is változik), lineáris
 *    interpolációval, 2 ms felfutás / 10 ms lecsengés a kattogás ellen;
 *  - **szeletelés tranziensre**: energia-alapú kezdet-keresés (10 ms-os ablak, emelkedés + küszöb, legalább
 *    80 ms távolság), az első `max` szelet (az első mindig 0);
 *  - **4 pad**: soronként egy szelet a 16-od rácson.
 */
import { Limiter } from '@/lib/audioDsp';
import type { SynthNote } from '@/lib/synth';

export const SAMPLER_SR = 44100;
export const DEFAULT_ROOT_MIDI = 60;
export const PAD_COUNT = 4;
type Stereo = [Float32Array, Float32Array];

const stepLen = (bpm: number) => 60 / (bpm > 0 ? bpm : 120) / 4;
const beatSec = (bpm: number) => 60 / (bpm > 0 ? bpm : 120);

/** a hangjegyek a mintával, kromatikusan (a hossz a leghosszabb hangig + a lecsengés) */
export function renderSamplerNotesPcm(sample: Float32Array[], notes: readonly SynthNote[], rootMidi: number, bpm: number, sr = SAMPLER_SR): Stereo {
  const a = sample[0];
  const b = sample[1] ?? sample[0];
  const fadeIn = Math.round(0.002 * sr);
  const fadeOut = Math.round(0.01 * sr);
  let end = 0;
  const plan = notes.slice(0, 512).map((n) => {
    const ratio = Math.pow(2, (n.midi - rootMidi) / 12);
    const start = Math.round(n.startBeat * beatSec(bpm) * sr);
    // a hang hossza: a hangjegy hossza, de legfeljebb amíg a minta tart ezen a sebességen
    const len = Math.min(Math.round(n.lengthBeats * beatSec(bpm) * sr), Math.floor((a.length - 1) / ratio));
    end = Math.max(end, start + len + fadeOut);
    return { ratio, start, len, gain: Number(n.velocity) > 0 ? Math.min(1, Number(n.velocity) / 127) : 0.8 };
  });
  const n = Math.max(1, end);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (const p of plan) {
    const total = p.len + fadeOut;
    for (let i = 0; i < total && p.start + i < n; i++) {
      const pos = i * p.ratio;
      const k = Math.floor(pos);
      if (k + 1 >= a.length) break;
      const f = pos - k;
      let env = p.gain;
      if (i < fadeIn) env *= i / fadeIn;
      if (i >= p.len) env *= 1 - (i - p.len) / fadeOut;
      l[p.start + i] += (a[k] + (a[k + 1] - a[k]) * f) * env;
      r[p.start + i] += (b[k] + (b[k + 1] - b[k]) * f) * env;
    }
  }
  new Limiter(0.95, 50, sr).processStereo(l, r);
  return [l, r];
}

/** a tranziensek (szelet-kezdetek mintában): az első mindig 0, legfeljebb `max` darab */
export function detectSlices(sample: Float32Array[], max = PAD_COUNT, sr = SAMPLER_SR): number[] {
  const a = sample[0];
  const win = Math.round(0.01 * sr);
  const env: number[] = [];
  for (let i = 0; i + win <= a.length; i += win) {
    let e = 0;
    for (let k = i; k < i + win; k++) {
      const v = (a[k] + (sample[1]?.[k] ?? a[k])) * 0.5;
      e += v * v;
    }
    env.push(e / win);
  }
  const peak = Math.max(1e-12, ...env);
  const minGap = Math.round(0.08 * sr);
  const starts = [0];
  for (let j = 1; j < env.length && starts.length < max; j++) {
    const at = j * win;
    if (env[j] > peak * 0.05 && env[j] > 4 * env[j - 1] + 1e-9 && at - starts[starts.length - 1] >= minGap) starts.push(at);
  }
  return starts;
}

/** a 4 pad: soronként a `slices[k]`-tól a következő szeletig (vagy a minta végéig) a lépéseken */
export function renderPadsPcm(sample: Float32Array[], slices: readonly number[], pads: readonly (readonly boolean[])[], bars: number, bpm: number, sr = SAMPLER_SR): Stereo {
  const a = sample[0];
  const b = sample[1] ?? sample[0];
  const n = Math.round(Math.max(1, Math.floor(bars)) * 16 * stepLen(bpm) * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const fade = Math.round(0.005 * sr);
  pads.slice(0, PAD_COUNT).forEach((row, k) => {
    const from = slices[k];
    if (from === undefined) return;
    const to = slices[k + 1] ?? a.length;
    const len = Math.max(0, to - from);
    row.forEach((on, step) => {
      if (!on) return;
      const s0 = Math.round(step * stepLen(bpm) * sr);
      for (let i = 0; i < len && s0 + i < n; i++) {
        const env = i >= len - fade ? (len - i) / fade : 1;
        l[s0 + i] += a[from + i] * env;
        r[s0 + i] += b[from + i] * env;
      }
    });
  });
  new Limiter(0.95, 50, sr).processStereo(l, r);
  return [l, r];
}

/** üres pad-rács `bars` ütemre */
export function emptyPads(bars: number): boolean[][] {
  return Array.from({ length: PAD_COUNT }, () => new Array(Math.max(1, Math.floor(bars)) * 16).fill(false));
}

/** a pad-rács új ütemszámra (a meglévő lépések maradnak) */
export function resizePads(pads: readonly (readonly boolean[])[], bars: number): boolean[][] {
  const n = Math.max(1, Math.floor(bars)) * 16;
  return Array.from({ length: PAD_COUNT }, (_, k) => Array.from({ length: n }, (_, i) => !!pads[k]?.[i]));
}

export const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (m: number) => `${MIDI_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
