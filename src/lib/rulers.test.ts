import {
  addGuide,
  clearGuides,
  compositionGuides,
  guidesForAxis,
  moveGuide,
  niceStep,
  removeGuide,
  rulerTicks,
  snapPointToGuides,
  snapToGuides,
  type Guide,
} from '@/lib/rulers';

describe('rulers — niceStep', () => {
  it('1-2-5·10ⁿ lépések', () => {
    expect(niceStep(8)).toBe(10);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(0.4)).toBe(0.5);
    expect(niceStep(0)).toBe(1); // degenerált
  });
});

describe('rulers — rulerTicks', () => {
  it('0..100 / 1000px: 10-es fő lépés, 2-es minor', () => {
    const ticks = rulerTicks(0, 100, 1000, 80, 5);
    expect(ticks).toHaveLength(51); // 0..100 lépés 2
    expect(ticks[0]).toEqual({ value: 0, px: 0, major: true, label: '0' });
    const major50 = ticks.find((t) => t.value === 50);
    expect(major50).toEqual({ value: 50, px: 500, major: true, label: '50' });
    const minor = ticks.find((t) => t.value === 2);
    expect(minor?.major).toBe(false);
    expect(minor?.label).toBeUndefined();
  });

  it('px-leképezés a viewStart-tól', () => {
    const ticks = rulerTicks(100, 200, 500);
    expect(ticks[0].px).toBe(0); // az első osztás px=0 a viewStart-nál kezdődik
    expect(ticks[ticks.length - 1].px).toBeLessThanOrEqual(500);
  });

  it('tört tartomány címkéz', () => {
    const ticks = rulerTicks(0, 1, 1000, 80, 5);
    const majors = ticks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(1);
    expect(majors.every((t) => typeof t.label === 'string')).toBe(true);
  });

  it('degenerált tartomány → üres', () => {
    expect(rulerTicks(0, 0, 100)).toEqual([]);
    expect(rulerTicks(0, 100, 0)).toEqual([]);
  });
});

describe('rulers — segédvonalak', () => {
  it('add / remove / move / clear / forAxis', () => {
    let g: Guide[] = addGuide([], 'x', 0.5);
    g = addGuide(g, 'y', 0.3);
    g = addGuide(g, 'x', 1.5); // clamp 0..1
    expect(g).toHaveLength(3);
    expect(g[2].pos).toBe(1);
    expect(guidesForAxis(g, 'x')).toHaveLength(2);
    const id = g[0].id;
    expect(moveGuide(g, id, -0.2)[0].pos).toBe(0); // clamp
    g = removeGuide(g, id);
    expect(g).toHaveLength(2);
    expect(clearGuides(g, 'y')).toHaveLength(1);
    expect(clearGuides(g)).toEqual([]);
  });

  it('snapToGuides küszöbön belül/kívül', () => {
    const g: Guide[] = [
      { id: 'a', axis: 'x', pos: 0.5 },
      { id: 'b', axis: 'y', pos: 0.3 },
    ];
    expect(snapToGuides(0.505, 'x', g, 0.01)).toEqual({ pos: 0.5, guideId: 'a' });
    expect(snapToGuides(0.52, 'x', g, 0.01)).toBeNull();
    // rossz tengely nem illeszt
    expect(snapToGuides(0.305, 'x', g, 0.01)).toBeNull();
  });

  it('snapPointToGuides tengelyenként függetlenül', () => {
    const g: Guide[] = [
      { id: 'a', axis: 'x', pos: 0.5 },
      { id: 'b', axis: 'y', pos: 0.3 },
    ];
    expect(snapPointToGuides({ x: 0.503, y: 0.9 }, g, 0.01)).toEqual({
      x: 0.5,
      y: 0.9,
      guideX: 'a',
      guideY: null,
    });
    expect(snapPointToGuides({ x: 0.503, y: 0.297 }, g, 0.01)).toEqual({
      x: 0.5,
      y: 0.3,
      guideX: 'a',
      guideY: 'b',
    });
  });

  it('compositionGuides harmadok', () => {
    const g = compositionGuides(true);
    expect(g).toHaveLength(6);
    expect(guidesForAxis(g, 'x')).toHaveLength(3);
    expect(compositionGuides(false)).toHaveLength(2);
  });
});
