import { AUTO_BLOCK, coeff, dbToLin, Gain, runChain, type Processor } from './processor';
import { highpassCoeffs, highShelf, lowpassCoeffs, lowShelf, peakingCoeffs } from './filters';
import { Compressor, Ducker, Limiter } from './dynamics';
import { Echo, Haas } from './delays';
import { buildFxChain } from './fxChain';

// Az `audioDsp` belső moduljai (REFACTOR): a publikus felületen át csak közvetve tesztelt
// segédek és együtthatók viselkedése rögzítve (bitre, a bontás előtti értékekkel).

describe('dsp/processor — közös segédek', () => {
  it('dB → lineáris, simítási együttható, automáció-rács', () => {
    expect(dbToLin(-6)).toBe(0.5011872336272722);
    expect(dbToLin(0)).toBe(1);
    expect(coeff(10, 48000)).toBe(0.002081164700700744);
    expect(AUTO_BLOCK).toBe(64);
  });

  it('a Gain helyben szoroz, a runChain sorban és a pozícióval hív', () => {
    const l = Float32Array.of(1, -0.5);
    const r = Float32Array.of(0.25, 2);
    new Gain(2).processStereo(l, r);
    expect([...l, ...r]).toEqual([2, -1, 0.5, 4]);
    const calls: string[] = [];
    const step = (name: string): Processor => ({ processStereo: (_l, _r, pos) => void calls.push(`${name}@${pos}`) });
    runChain([step('a'), step('b')], l, r, 128);
    runChain([step('c')], l, r);
    expect(calls).toEqual(['a@128', 'b@128', 'c@0']);
  });
});

describe('dsp/filters — RBJ-együtthatók', () => {
  it('felül-, aluláteresztő és csúcs-EQ (nem normált alak)', () => {
    expect(highpassCoeffs(1000, 48000)).toEqual({ b0: 0.9957224306869052, b1: -1.9914448613738105, b2: 0.9957224306869052, a0: 1.092309895488014, a1: -1.9828897227476208, a2: 0.9076901045119862 });
    expect(lowpassCoeffs(1000, 48000, 2)).toEqual({ b0: 0.004277569313094809, b1: 0.008555138626189618, b2: 0.004277569313094809, a0: 1.0326315480550128, a1: -1.9828897227476208, a2: 0.9673684519449871 });
    expect(peakingCoeffs(1000, 6, 48000)).toEqual({ b0: 1.0921865735337346, b1: -1.9828897227476208, b2: 0.9078134264662654, a0: 1.0462027337669495, a1: -1.9828897227476208, a2: 0.9537972662330504 });
  });

  it('a polcok normált együtthatói (master-EQ)', () => {
    expect([...highShelf(8000, 3, 44100).coeffs()]).toEqual([1.2418250003470803, -0.7467116271932109, 0.29335373312096596, -0.41349377749105076, 0.201960883765886]);
    expect([...lowShelf(110, -4, 44100).coeffs()]).toEqual([0.9974460022698126, -1.9751892807522808, 0.9779359802135708, -1.9751329257869321, 0.9754383374487323]);
  });
});

describe('dsp/dynamics és delays — határesetek', () => {
  it('a kompresszor görbéje: a térd alatt 0, fölötte az arány szerint', () => {
    const c = new Compressor(-18, 3, 5, 150, 48000);
    expect(c.gainDb(-40)).toBe(0);
    expect(c.gainDb(0)).toBeCloseTo(-12, 12);
  });

  it('a limiter kimenete sosem lépi át a plafont', () => {
    const l = Float32Array.of(2, -3, 0.1);
    const r = Float32Array.of(-2, 3, 0.1);
    new Limiter(0.5, 50, 48000).processStereo(l, r);
    for (const x of [...l, ...r]) expect(Math.abs(x)).toBeLessThanOrEqual(0.5 + 1e-7);
  });

  it('a halkító csend-kulcsnál nem halkít', () => {
    const bl = Float32Array.of(0.5, 0.5);
    const br = Float32Array.of(0.5, 0.5);
    new Ducker(48000).process(bl, br, new Float32Array(2), new Float32Array(2));
    expect([...bl, ...br]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('nem véges késleltetés → RangeError (a jelenlegi viselkedés rögzítve)', () => {
    expect(() => new Echo(1, 1, [Infinity], [0.5], 48000)).toThrow(RangeError);
    expect(() => new Haas(48000, Infinity)).toThrow(RangeError);
  });
});

describe('dsp/fxChain — a lánc összetétele', () => {
  it('visszhang-csökkentés: kapu + 300 Hz-es csúcs-EQ a lánc elején, normalizálás + limiter a végén', () => {
    const names = buildFxChain({ normalize: true, limiter: true, reverb: 0.5 }, 48000, 1.5, true).map((p) => p.constructor.name);
    expect(names).toEqual(['Gate', 'Biquad', 'Echo', 'Gain', 'Limiter', 'Limiter']);
  });

  it('automáció statikus érték nélkül is felépíti az automatizált fokozatot', () => {
    const kf = [{ time: 0, value: 0.5, easing: 'linear' as const }];
    expect(buildFxChain(undefined, 48000, 1, false, { fxReverb: kf, fxEqMidFreq: [{ ...kf[0], value: 2000 }] }).map((p) => p.constructor.name)).toEqual(['AutoBiquad', 'Echo']);
    expect(buildFxChain(undefined, 48000, 1, false, { fxReverb: [] })).toEqual([]);
  });
});
