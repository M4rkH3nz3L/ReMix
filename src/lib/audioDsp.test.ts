import { buildFxChain, Compressor, DeEsser, Echo, Gate, Haas, Limiter, fxUnsupported, runChain, type Processor } from './audioDsp';

const SR = 44100;
const sine = (freq: number, amp: number, sec = 1) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const rmsDb = (x: Float32Array, from = 0) => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / (x.length - from) + 1e-30);
};
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const run = (p: { processStereo: (l: Float32Array, r: Float32Array, pos: number) => void }, x: Float32Array) => {
  const l = Float32Array.from(x);
  const r = Float32Array.from(x);
  p.processStereo(l, r, 0);
  return l;
};
const tail = Math.round(0.5 * SR); // a beállás utáni rész

describe('🗜️ Compressor', () => {
  it('a statikus görbe: küszöb alatt 0 dB, fölötte (1/arány − 1)·túllépés, lágy térddel', () => {
    const c = new Compressor(-18, 3, 5, 150, SR);
    expect(c.gainDb(-40)).toBe(0);
    expect(c.gainDb(-6)).toBeCloseTo(-8, 5);
    expect(c.gainDb(-18)).toBeLessThan(0);
    expect(c.gainDb(-18)).toBeGreaterThan(-2);
  });
  it('halk jel érintetlen, a hangos visszafogva (beállás után)', () => {
    const quiet = sine(440, 0.01);
    expect(rmsDb(run(new Compressor(-18, 3, 5, 150, SR), quiet), tail) - rmsDb(quiet, tail)).toBeCloseTo(0, 1);
    // −3 dB RMS (amplitúdó 1): 15 dB a küszöb fölött → a statikus görbe −10 dB; az 5 ms-os
    // felfutású RMS-érzékelő a hullám csúcsaira is reagál, ezért kicsit többet fog vissza
    const loud = sine(440, 1);
    const cut = rmsDb(run(new Compressor(-18, 3, 5, 150, SR), loud), tail) - rmsDb(loud, tail);
    expect(cut).toBeLessThan(-9);
    expect(cut).toBeGreaterThan(-13);
  });
});

describe('🧱 Limiter', () => {
  it('a kimenet soha nem lépi át a plafont; a halk jel érintetlen', () => {
    expect(peak(run(new Limiter(0.95, 50, SR), sine(440, 1.6)))).toBeLessThanOrEqual(0.95 + 1e-6);
    const q = sine(440, 0.3);
    expect(Math.abs(rmsDb(run(new Limiter(0.95, 50, SR), q)) - rmsDb(q))).toBeLessThan(0.01);
  });
});

describe('🚪 Gate', () => {
  it('a halk zajt elnyomja, a hangos jelet átengedi', () => {
    const noise = Float32Array.from({ length: SR }, (_, i) => 0.005 * Math.sin(i * 12.9898) * Math.cos(i * 78.233));
    expect(rmsDb(run(new Gate(0.05, 9, 5, 80, 0.06, SR), noise), tail) - rmsDb(noise, tail)).toBeLessThan(-20);
    const loud = sine(440, 0.5);
    expect(Math.abs(rmsDb(run(new Gate(0.05, 9, 5, 80, 0.06, SR), loud), tail) - rmsDb(loud, tail))).toBeLessThan(0.5);
  });
});

describe('🐍 DeEsser', () => {
  it('a sziszegő sávot halkítja, a mélyet nem', () => {
    const ss = sine(7000, 0.5);
    expect(rmsDb(run(new DeEsser(SR), ss), tail) - rmsDb(ss, tail)).toBeLessThan(-6);
    const low = sine(300, 0.5);
    expect(Math.abs(rmsDb(run(new DeEsser(SR), low), tail) - rmsDb(low, tail))).toBeLessThan(0.5);
  });
});

describe('lánc', () => {
  it('darabolva ugyanaz, mint egyben (az állapot átmegy)', () => {
    const fx = { highpass: 100, compressor: true, deEsser: true, gate: true, limiter: true };
    // váltakozó hangos/halk és sziszegő részek: minden feldolgozó dolgozik
    const x = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * (i % 15000 < 5000 ? 7000 : 220) * i) / SR) * (i % 20000 < 10000 ? 0.9 : 0.02));
    const wholeL = Float32Array.from(x);
    const wholeR = Float32Array.from(x);
    runChain(buildFxChain(fx, SR), wholeL, wholeR);
    const chain = buildFxChain(fx, SR);
    const parts = Float32Array.from(x);
    for (let a = 0; a < SR; a += 5512) {
      const l = parts.subarray(a, Math.min(SR, a + 5512));
      const r = Float32Array.from(l);
      runChain(chain, l, r, a);
    }
    let maxDiff = 0;
    for (let i = 0; i < SR; i++) maxDiff = Math.max(maxDiff, Math.abs(parts[i] - wholeL[i]));
    expect(maxDiff).toBeLessThan(1e-6);
  });
  it('a még nem támogatott effektek jelzése', () => {
    expect(fxUnsupported({ compressor: true, limiter: true, gate: true, deEsser: true, eq: { low: 1, mid: 0, high: 0 } })).toBe(false);
    expect(fxUnsupported({ reverb: 0.3, delay: 0.5, stereoWide: true })).toBe(false);
    expect(fxUnsupported({ denoise: true })).toBe(true);
  });
});

describe('🏛️ Echo / Haas', () => {
  it('impulzus: a leágazások a helyükön, a beállított csillapítással', () => {
    const x = new Float32Array(SR / 5);
    x[0] = 1;
    const y = run(new Echo(0.8, 0.9, [40, 75], [0.5, 0.35], SR), x);
    expect(y[0]).toBeCloseTo(0.72, 6);
    expect(y[Math.round(0.04 * SR)]).toBeCloseTo(0.45, 6);
    expect(y[Math.round(0.075 * SR)]).toBeCloseTo(0.315, 6);
    expect(y[100]).toBe(0);
  });
  it('a késleltetés darabok között is folytonos', () => {
    const x = new Float32Array(SR);
    x[1000] = 1;
    const whole = run(new Echo(1, 1, [300], [0.5], SR), x);
    const e = new Echo(1, 1, [300], [0.5], SR);
    const parts = Float32Array.from(x);
    for (let a = 0; a < SR; a += 5512) {
      const l = parts.subarray(a, Math.min(SR, a + 5512));
      (e as Processor).processStereo(l, Float32Array.from(l), a);
    }
    expect(parts[1000 + Math.round(0.3 * SR)]).toBeCloseTo(0.5, 6);
    expect(Array.from(parts)).toEqual(Array.from(whole));
  });
  it('Haas: a közép jel a két oldalra eltérő késéssel', () => {
    const l = new Float32Array(400);
    const r = new Float32Array(400);
    l[0] = 1;
    r[0] = 1;
    (new Haas(SR) as Processor).processStereo(l, r, 0);
    expect(l[Math.round(0.00205 * SR)]).toBe(1);
    expect(r[Math.round(0.00212 * SR)]).toBe(1);
    expect(l[0]).toBe(0);
  });
});

