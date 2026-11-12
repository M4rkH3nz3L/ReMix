import { KERNEL, nativeDspActive, runKernel, runKernelJs, setNativeDsp } from '@/lib/dspKernels';
import { mixRange, offlineMixPlan, OFFLINE_SAMPLE_RATE as SR } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
/**
 * ⚡ Golden-teszt: a közös DSP kimenete bitre változatlan (minden effekt, automáció, busz, halkítás,
 * master kompresszorral és szaturációval). A natív magra váltás (dspKernels) előtti kód ugyanezt adta;
 * ha ez a szám változik, a telefon és a szerver közti paritás is változhatott — szándékos legyen.
 */
it('a DSP kimenete bitre a rögzített (d03680fa)', () => {
  const fx = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true, normalize: true };
  const base = createEmptyProject('x', '9:16', undefined, 'audio');
  const kf = [{ id: 'k1', time: 0, value: 0.1 }, { id: 'k2', time: 3, value: 0.9 }];
  const mk = (cid: string, start: number, pan: number, extra: object = {}) => ({ kind: 'audio', id: cid, uri: 'file:///a.wav', label: cid, start, duration: 6, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0.2, fadeOut: 0.3, pan, audioFx: fx, source: 'imported', ...extra });
  const project = { ...base, audioBuses: [{ id: 'rev', name: 'Z', fx: { reverb: 0.5 }, gain: 0.8 }], audioSends: { sfx: { rev: 0.6 } }, audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true, compressor: { threshold: -20, ratio: 4 }, saturation: 0.4 }, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5, { autoDuck: true, fxKf: { fxReverb: kf, fxLowpass: [{ id: 'a', time: 0, value: 3000 }, { id: 'b', time: 4, value: 15000 }] } })] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) } as never;
  const plan = { ...offlineMixPlan(project), masterGain: 1.3 };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const src = Float32Array.from({ length: 20 * SR }, (_, i) => Math.sin(i / 20) * 0.3 + rnd() * 0.05 * (i % 20000 < 6000 ? 1 : 0.1));
  const sources = new Map([['file:///a.wav', { channels: [src, Float32Array.from(src, (v) => v * 0.8)], sampleRate: SR }]]);
  const state = new Map();
  const CH = Math.round(0.125 * SR);
  let h = 0;
  for (let a = 0; a < 7 * SR; a += CH) {
    const out: [Float32Array, Float32Array] = [new Float32Array(CH), new Float32Array(CH)];
    mixRange(plan as never, sources as never, out, a, a + CH, 1, state);
    const u = new Uint32Array(out[0].buffer);
    const v = new Uint32Array(out[1].buffer);
    for (let i = 0; i < u.length; i++) h = (Math.imul(h, 31) + u[i] + Math.imul(v[i], 7)) >>> 0;
  }
  expect(h.toString(16)).toBe('d03680fa');
});

it('a JS-mag a natív bekötés nélkül fut, és azonos tömbre is a sorrendi viselkedést adja', () => {
  expect(nativeDspActive()).toBe(false);
  const calls: number[] = [];
  setNativeDsp((k) => calls.push(k));
  const a = Float32Array.of(0.1, 0.2, 0.3);
  runKernel(KERNEL.BIQUAD, a, a, Float64Array.of(1, 0, 0, 0, 0), new Float64Array(8));
  expect(calls).toEqual([]); // azonos tömb → JS
  runKernel(KERNEL.BIQUAD, a, Float32Array.from(a), Float64Array.of(1, 0, 0, 0, 0), new Float64Array(8));
  expect(calls).toEqual([KERNEL.BIQUAD]);
  setNativeDsp(null);
  const x = Float32Array.of(0.5, -0.5);
  runKernelJs(KERNEL.SAT, x, Float32Array.from(x), Float64Array.of(2, 1 / Math.tanh(2)), new Float64Array(0));
  expect(x[0]).toBeCloseTo(Math.tanh(1) / Math.tanh(2), 6);
});
