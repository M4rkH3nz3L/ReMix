import { aiDrumGrid, usedBars } from '@/lib/drumAi';
import type { DrumRnn } from '@/lib/drumRnn';
import { DRUM_ACCENT, emptyPattern, toggleStep } from '@/lib/drums';

/** álmodell: minden új lépés = lábdob + nyitott hi-hat (bit 0 + bit 3); a hívás paramétereit rögzíti */
function fake() {
  const calls: { primer: number[]; steps: number; t?: number }[] = [];
  const m = {
    continue(primer: readonly number[], steps: number, t?: number) {
      calls.push({ primer: [...primer], steps, t });
      return { labels: new Array(steps).fill(1 | 8), probs: [] };
    },
  } as unknown as DrumRnn;
  return { m, calls };
}
const rnd = () => 0.5;

describe('drumAi — V8 AI-dob a dobgép rácsán', () => {
  const oneBar = () => {
    let p = emptyPattern(1);
    for (const s of [0, 8]) p = toggleStep(p, 'kick', s);
    p = toggleStep(p, 'clap', 4);
    return p;
  };

  test('folytatás: 1 ütem → 2 ütem, az első változatlan (a clap is), a második a modellé', () => {
    const { m, calls } = fake();
    const g = aiDrumGrid(m, { bars: 1, pattern: oneBar(), velocity: { kick: [DRUM_ACCENT] } }, 'continue', 1, rnd);
    expect(g.bars).toBe(2);
    expect(calls[0].primer).toHaveLength(16);
    expect(calls[0].steps).toBe(16);
    expect(g.pattern.clap[4]).toBe(true);
    expect(g.pattern.kick.slice(0, 16).filter(Boolean)).toHaveLength(2);
    expect(g.pattern.kick.slice(16).every(Boolean)).toBe(true);
    // a régi szint marad, az új részen a nyitott hi-hat hangsúlyos hi-hat
    expect(g.velocity.kick?.[0]).toBe(DRUM_ACCENT);
    expect(g.velocity.hihat?.[16]).toBe(DRUM_ACCENT);
    expect(g.velocity.hihat?.[3]).toBeUndefined();
  });

  test('variáció: több ütemnél az első marad; 1 ütemnél az első beat', () => {
    const { m, calls } = fake();
    const two = { bars: 2, pattern: oneBar(), velocity: {} };
    expect(aiDrumGrid(m, two, 'vary', 1, rnd).bars).toBe(2);
    expect(calls[0].primer).toHaveLength(16);
    aiDrumGrid(m, { bars: 1, pattern: oneBar(), velocity: {} }, 'vary', 1, rnd);
    expect(calls[1].primer).toHaveLength(4);
    expect(calls[1].steps).toBe(12);
  });

  test('új groove és üres rács: egy lábdobból indul, a hőmérséklet átmegy', () => {
    const { m, calls } = fake();
    const g = aiDrumGrid(m, { bars: 2, pattern: oneBar(), velocity: {} }, 'groove', 1.3, rnd);
    expect(calls[0].primer).toEqual([1]);
    expect(calls[0].steps).toBe(31);
    expect(calls[0].t).toBe(1.3);
    expect(g.pattern.clap[4]).toBe(false);
    aiDrumGrid(m, { bars: 1, pattern: emptyPattern(1), velocity: {} }, 'continue', 1, rnd);
    expect(calls[1].primer).toEqual([1]);
  });

  test('a teli (4 ütemes) rács folytatása nem nő tovább; a használt ütemek', () => {
    const { m } = fake();
    let p = emptyPattern(4);
    p = toggleStep(p, 'kick', 60);
    expect(usedBars(p, 4)).toBe(4);
    expect(usedBars(emptyPattern(2), 2)).toBe(0);
    expect(aiDrumGrid(m, { bars: 4, pattern: p, velocity: {} }, 'continue', 1, rnd).bars).toBe(4);
  });
});
