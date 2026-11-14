import { drumVoicePcm, gridSec, renderDrumsPcm, renderSamplerPcm, renderSynthPcm, waveSample } from '@/lib/instrumentRender';
import type { SynthWave } from '@/lib/synth';

/** 🎹🥁🎛️ A telefonos hangszerek mérhető tulajdonságai. */

const SR = 44100;
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsDb = (x: Float32Array) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length) + 1e-30);
/** az alapfrekvencia a pozitív nullátmenetekből (Hz) */
const pitchHz = (x: Float32Array) => {
  const ups: number[] = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] <= 0 && x[i] > 0) ups.push(i);
  return ups.length > 2 ? ((ups.length - 1) * SR) / (ups[ups.length - 1] - ups[0]) : 0;
};
/** nullátmenet-sűrűség (Hz) — zajnál a hangszín durva mérője */
const zcHz = (x: Float32Array) => {
  let z = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
  return (z / 2) * (SR / x.length);
};

describe('🎹 synth', () => {
  it.each(['sine', 'square', 'triangle', 'sawtooth'] as SynthWave[])('%s: A4 = 440 Hz, a hullám csúcsa ~0,45–0,5', (wave) => {
    const [l, r] = renderSynthPcm([{ id: 'a', midi: 69, startBeat: 0, lengthBeats: 2 }], wave, 120);
    expect(l.length).toBe(SR); // 2 beat @120 = 1 s
    expect(Math.abs(pitchHz(l.subarray(4410, 39690)) - 440)).toBeLessThan(1);
    expect(peak(l)).toBeGreaterThan(0.3);
    expect(peak(l)).toBeLessThanOrEqual(0.95);
    expect(Array.from(r)).toEqual(Array.from(l));
    expect(Math.abs(waveSample(wave, 440, 0.123))).toBeLessThanOrEqual(0.5);
  });
  it('a hang a beatjén indul, felfutás/lecsengés kattanás nélkül, a velocity a szint', () => {
    const [l] = renderSynthPcm([{ id: 'a', midi: 60, startBeat: 1, lengthBeats: 1, velocity: 127 }, { id: 'b', midi: 60, startBeat: 3, lengthBeats: 1, velocity: 64 }], 'sine', 120);
    expect(peak(l.subarray(0, Math.round(0.5 * SR)))).toBe(0); // az 1. beat előtt csend
    expect(Math.abs(l[Math.round(0.5 * SR)])).toBeLessThan(1e-3); // 0-ról indul
    expect(Math.abs(l[Math.round(1 * SR) - 1])).toBeLessThan(1e-3); // 0-ra cseng le
    const loud = rmsDb(l.subarray(Math.round(0.6 * SR), Math.round(0.9 * SR)));
    const soft = rmsDb(l.subarray(Math.round(1.6 * SR), Math.round(1.9 * SR)));
    expect(loud - soft).toBeCloseTo(20 * Math.log10(127 / 64), 1);
  });
});

describe('🥁 dobok', () => {
  it('kick: lecsengő, mély hangmagasság-eséssel', () => {
    const k = drumVoicePcm('kick');
    expect(k.length).toBe(Math.round(0.3 * SR));
    expect(pitchHz(k.subarray(0, 2205))).toBeGreaterThan(pitchHz(k.subarray(4410, 8820)) + 15);
    expect(rmsDb(k.subarray(0, 2205))).toBeGreaterThan(rmsDb(k.subarray(8820)) + 20);
  });
  it('a hangszín sorrendje: hihat > snare > clap; mindegyik elhalkul', () => {
    const [sn, hh, cl] = (['snare', 'hihat', 'clap'] as const).map((v) => drumVoicePcm(v));
    expect(zcHz(hh)).toBeGreaterThan(zcHz(sn));
    expect(zcHz(sn)).toBeGreaterThan(zcHz(cl));
    for (const x of [sn, hh, cl]) expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-2);
  });
  it('determinisztikus: ugyanaz a minta mindig ugyanúgy szól', () => {
    expect(Array.from(drumVoicePcm('snare'))).toEqual(Array.from(drumVoicePcm('snare')));
  });
  it('a minta pontosan a rács hosszú (loopolható), az ütések a lépéseken', () => {
    const [l] = renderDrumsPcm([{ voice: 'kick', step: 0 }, { voice: 'kick', step: 4 }], 1, 100);
    expect(l.length).toBe(Math.round(gridSec(1, 100) * SR)); // 16 × 0,15 s = 2,4 s
    const at = Math.round(4 * 0.15 * SR);
    expect(peak(l.subarray(at - 200, at - 1))).toBeLessThan(1e-3); // az ütés előtt (a kick már lecsengett)
    expect(peak(l.subarray(at, at + 441))).toBeGreaterThan(0.3);
    expect(peak(l)).toBeLessThanOrEqual(0.95);
  });
});

describe('🎛️ sampler', () => {
  it('a minta a lépéseken, sztereóban, a rács hosszán', () => {
    const left = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 10) * 0.5);
    const right = Float32Array.from({ length: 2000 }, (_, i) => Math.cos(i / 10) * 0.5);
    const [l, r] = renderSamplerPcm([left, right], [0, 8], 1, 120);
    expect(l.length).toBe(Math.round(2 * SR));
    const at = Math.round(8 * 0.125 * SR);
    expect(l[at + 100]).toBeCloseTo(left[100], 6);
    expect(r[at + 100]).toBeCloseTo(right[100], 6);
  });
});

// ── 🥁 S12: a négy új dob-hang ──────────────────────────────────────────────────────────────────
describe('instrumentRender — S12: tom, rim, crash, perc', () => {
  it('a négy új hang nem üres, determinisztikus, a várt hosszal (tom 0,35 s · rim 0,05 · crash 0,9 · perc 0,09)', () => {
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const lens: Record<string, number> = { tom: 0.35, rim: 0.05, crash: 0.9, perc: 0.09 };
    for (const v of ['tom', 'rim', 'crash', 'perc'] as const) {
      const x = drumVoicePcm(v);
      expect(x.length).toBe(Math.round(lens[v] * 44100));
      expect(peak(x)).toBeGreaterThan(0.1);
      expect(Array.from(drumVoicePcm(v))).toEqual(Array.from(x));
    }
    // a crash lecseng: a vége halkabb, mint az eleje
    const c = drumVoicePcm('crash');
    expect(peak(c.subarray(c.length - 4410))).toBeLessThan(peak(c.subarray(0, 4410)) * 0.2);
  });
});
