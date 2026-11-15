import { alignAndMix, denoiseFrames, measureDelay, padForDenoise, RNNOISE_DELAY, RNNOISE_FRAME, StreamingDenoiser } from '@/lib/aiDenoise';

describe('aiDenoise — V8 AI-zajszűrés (a modell köré épülő jelút)', () => {
  test('keretezés: a teljes jel + a késés kiürítése, egész keretre', () => {
    expect(denoiseFrames(480)).toBe(Math.ceil((480 + RNNOISE_DELAY) / RNNOISE_FRAME));
    expect(denoiseFrames(1)).toBe(Math.ceil((1 + RNNOISE_DELAY) / RNNOISE_FRAME));
    const p = padForDenoise(Float32Array.from([1, 2, 3]));
    expect(p.length % RNNOISE_FRAME).toBe(0);
    expect(Array.from(p.subarray(0, 4))).toEqual([1, 2, 3, 0]);
  });

  test('késés-kiegyenlítés: a „modell” = késleltetett másolat → 100%-on az eredeti, hossz-tartó', () => {
    const dry = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i * 0.05));
    const wet = new Float32Array(padForDenoise(dry).length);
    wet.set(dry, RNNOISE_DELAY);
    const out = alignAndMix(dry, wet, 1);
    expect(out.length).toBe(dry.length);
    expect(Math.max(...out.map((x, i) => Math.abs(x - dry[i])))).toBeLessThan(1e-6);
  });

  test('erősség: 0 = eredeti, 0,5 = fele-fele; tartományon kívül szorítva', () => {
    const dry = Float32Array.from([1, 1, 1]);
    const wet = new Float32Array(3 + RNNOISE_DELAY);
    expect(Array.from(alignAndMix(dry, wet, 0))).toEqual([1, 1, 1]);
    expect(Array.from(alignAndMix(dry, wet, 0.5))).toEqual([0.5, 0.5, 0.5]);
    expect(Array.from(alignAndMix(dry, wet, 7))).toEqual([0, 0, 0]);
  });

  test('a késés mérése keresztkorrelációval', () => {
    let seed = 3;
    const dry = Float32Array.from({ length: 6000 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5);
    const wet = new Float32Array(dry.length + 1000);
    wet.set(dry, 480);
    expect(measureDelay(dry, wet, 1000)).toBe(480);
  });
});

describe('StreamingDenoiser — folyamatos AI-zajszűrő (44,1 → 48 → modell → 44,1 kHz)', () => {
  const delayModel = (delay: number) => {
    // „modell”: a bemenet `delay` mintával késleltetett másolata, csatornánként állapottal
    const tails = new Map<number, Float32Array>();
    return (c: number, input: Float32Array, output: Float32Array) => {
      const prev = tails.get(c) ?? new Float32Array(delay);
      const joined = new Float32Array(prev.length + input.length);
      joined.set(prev);
      joined.set(input, prev.length);
      output.set(joined.subarray(0, input.length));
      tails.set(c, joined.slice(input.length));
      return 0.5;
    };
  };

  test('azonos (késleltető) modell: a kimenet = a bemenet (az átmintavételezés pontosságán belül), a hossz pontos, darabolás-független', () => {
    const n = 44100 * 3;
    const l = Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / 44100));
    const r = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 44100));
    const run = (chunk: number) => {
      const d = new StreamingDenoiser(2, 1, delayModel(RNNOISE_DELAY));
      const outs: Float32Array[][] = [];
      for (let a = 0; a < n; a += chunk) outs.push(d.push([l.subarray(a, Math.min(n, a + chunk)), r.subarray(a, Math.min(n, a + chunk))]));
      outs.push(d.finish());
      return [0, 1].map((c) => {
        const len = outs.reduce((s, o) => s + o[c].length, 0);
        const out = new Float32Array(len);
        let at = 0;
        for (const o of outs) {
          out.set(o[c], at);
          at += o[c].length;
        }
        return out;
      });
    };
    const a = run(8192);
    const b = run(30000);
    expect(Math.abs(a[0].length - n)).toBeLessThanOrEqual(1);
    let err = 0;
    for (let i = 2000; i < n - 2000; i++) err = Math.max(err, Math.abs(a[0][i] - l[i]), Math.abs(a[1][i] - r[i]));
    expect(err).toBeLessThan(2e-3);
    let diff = 0;
    for (let i = 0; i < Math.min(a[0].length, b[0].length); i++) diff = Math.max(diff, Math.abs(a[0][i] - b[0][i]));
    expect(diff).toBeLessThan(1e-6);
  });

  test('erősség 0: a „modell” kimenete nem számít (csendet ad) → az eredeti; a VAD átlagolva', () => {
    const n = 44100;
    const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.01));
    const d = new StreamingDenoiser(1, 0, (_c, _i, o) => {
      o.fill(0);
      return 0.25;
    });
    const out = [...d.push([x]), ...d.finish()];
    const all = new Float32Array(out.reduce((s, o) => s + o.length, 0));
    let at = 0;
    for (const o of out) {
      all.set(o, at);
      at += o.length;
    }
    let err = 0;
    for (let i = 2000; i < n - 2000; i++) err = Math.max(err, Math.abs(all[i] - x[i]));
    expect(err).toBeLessThan(2e-3);
    expect(d.vad).toBeCloseTo(0.25, 6);
  });
});
