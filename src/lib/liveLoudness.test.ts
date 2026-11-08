import { integratedLoudness } from './loudness';
import { LiveLoudness } from './liveLoudness';

const SR = 48000;
const sine = (sec: number, hz: number, dbfs: number, phase = 0) => {
  const a = Math.pow(10, dbfs / 20);
  return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => a * Math.sin((2 * Math.PI * hz * i) / SR + phase));
};
const feed = (m: LiveLoudness, l: Float32Array, r: Float32Array, chunk = 4096) => {
  for (let a = 0; a < l.length; a += chunk) m.push(a, l.subarray(a, Math.min(l.length, a + chunk)), r.subarray(a, Math.min(r.length, a + chunk)));
};

describe('LiveLoudness (BS.1770 / EBU R128)', () => {
  it('EBU Tech 3341: 1 kHz szinusz −23 dBFS mindkét csatornán → −23,0 ± 0,1 LUFS (momentary, short-term, integrált)', () => {
    const x = sine(5, 1000, -23);
    const m = new LiveLoudness(SR);
    feed(m, x, x);
    const r = m.readAt(x.length);
    expect(r.momentary).toBeCloseTo(-23, 1);
    expect(r.shortTerm).toBeCloseTo(-23, 1);
    expect(r.integrated).toBeCloseTo(-23, 1);
  });
  it('a darabolás nem számít, és az integrált = a meglévő offline mérő (a kapuval: halk + hangos rész)', () => {
    const quiet = sine(3, 440, -45);
    const loud = sine(4, 440, -18);
    const l = new Float32Array(quiet.length + loud.length);
    l.set(quiet);
    l.set(loud, quiet.length);
    const m1 = new LiveLoudness(SR);
    feed(m1, l, l, 1000);
    const m2 = new LiveLoudness(SR);
    feed(m2, l, l, 16384);
    expect(m1.readAt(l.length).integrated).toBeCloseTo(m2.readAt(l.length).integrated, 6);
    expect(m1.readAt(l.length).integrated).toBeCloseTo(integratedLoudness(l, l, SR), 1);
  });
  it('true-peak: fs/4-es szinusz 45°-os fázissal — a mintacsúcs −3 dB, a true-peak 0 dBTP (±0,2)', () => {
    const x = sine(1, SR / 4, 0, Math.PI / 4);
    const samplePeak = 20 * Math.log10(x.reduce((a, v) => Math.max(a, Math.abs(v)), 0));
    expect(samplePeak).toBeCloseTo(-3.01, 1);
    const m = new LiveLoudness(SR);
    feed(m, x, x);
    expect(m.readAt(x.length).truePeakMax).toBeGreaterThan(-0.2);
    expect(m.readAt(x.length).truePeakMax).toBeLessThan(0.2);
  });
  it('a mérés a lejátszófejig tart (az előre renderelt rész nem számít); ugrásnál újraindul', () => {
    const quiet = sine(4, 1000, -40);
    const loud = sine(4, 1000, -10);
    const l = new Float32Array(quiet.length + loud.length);
    l.set(quiet);
    l.set(loud, quiet.length);
    const m = new LiveLoudness(SR);
    feed(m, l, l);
    expect(m.readAt(quiet.length).shortTerm).toBeCloseTo(-40, 0);
    // ugrás: más helyről érkező szelet → az addigi mérés eldobva
    m.push(10 * SR, loud.subarray(0, SR), loud.subarray(0, SR));
    expect(m.readAt(10 * SR + SR).integrated).toBeCloseTo(-10, 0);
    expect(m.readAt(10 * SR + SR).shortTerm).toBe(-Infinity);
  });
});
