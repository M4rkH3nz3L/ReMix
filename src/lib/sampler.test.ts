import {
  activeSteps,
  emptySampler,
  resizeSampler,
  samplerDurationSec,
  samplerHasHits,
  STEPS_PER_BAR,
  toggleSamplerStep,
} from '@/lib/sampler';

describe('sampler — step-rács mag', () => {
  it('emptySampler: bars × 16 üres', () => {
    expect(emptySampler(1)).toHaveLength(STEPS_PER_BAR);
    expect(emptySampler(2)).toHaveLength(32);
    expect(emptySampler(1).every((x) => x === false)).toBe(true);
  });

  it('toggleSamplerStep: be/ki, tartományon kívül no-op', () => {
    let p = emptySampler(1);
    p = toggleSamplerStep(p, 0);
    p = toggleSamplerStep(p, 4);
    expect(p[0]).toBe(true);
    expect(p[4]).toBe(true);
    p = toggleSamplerStep(p, 0);
    expect(p[0]).toBe(false);
    expect(toggleSamplerStep(p, 999)).toBe(p);
  });

  it('activeSteps: az aktív indexek sorrendben', () => {
    let p = emptySampler(1);
    [0, 4, 8, 12].forEach((s) => (p = toggleSamplerStep(p, s)));
    expect(activeSteps(p)).toEqual([0, 4, 8, 12]);
  });

  it('samplerHasHits', () => {
    expect(samplerHasHits(emptySampler(1))).toBe(false);
    expect(samplerHasHits(toggleSamplerStep(emptySampler(1), 3))).toBe(true);
  });

  it('samplerDurationSec: 1 ütem @120 BPM = 2s', () => {
    expect(samplerDurationSec(1, 120)).toBe(2);
    expect(samplerDurationSec(2, 120)).toBe(4);
  });

  it('resizeSampler: megőrzi a tartományba eső ütéseket', () => {
    let p = emptySampler(2); // 32 lépés
    p = toggleSamplerStep(p, 0);
    p = toggleSamplerStep(p, 20);
    const shrunk = resizeSampler(p, 1); // 16 lépés
    expect(shrunk).toHaveLength(16);
    expect(shrunk[0]).toBe(true);
    expect(activeSteps(shrunk)).toEqual([0]); // a 20. kiesett
  });
});
