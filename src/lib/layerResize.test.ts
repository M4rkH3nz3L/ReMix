import { resizeFromCorner, type ResizeStart } from '@/lib/layerResize';

const start: ResizeStart = { cx: 100, cy: 100, halfW: 50, halfH: 50, rotation: 0 };
const limits = { minSide: 24, maxSide: 2000 };

describe('resizeFromCorner', () => {
  it('a jobb alsó sarok követi az ujjat, a bal felső áll', () => {
    const r = resizeFromCorner(start, 'br', 50, 50, limits);
    expect(r.factor).toBeCloseTo(1.5);
    expect(r.cx - 50 * r.factor).toBeCloseTo(50); // a horgony-sarok helyben
    expect(r.cy - 50 * r.factor).toBeCloseTo(50);
    expect(r.cx + 50 * r.factor).toBeCloseTo(150 + 50);
  });
  it.each([['tl', -40, -40], ['tr', 40, -40], ['bl', -40, 40], ['br', 40, 40]] as const)('%s: kifelé húzva nő, ugyanannyival', (corner, dx, dy) => {
    expect(resizeFromCorner(start, corner, dx, dy, limits).factor).toBeCloseTo(1.4);
  });
  it('a keresztirányú mozgás nem változtat méretet', () => {
    expect(resizeFromCorner(start, 'br', 40, -40, limits).factor).toBeCloseTo(1);
  });
  it('nem fordul át: a szemközti sarkon túl a minimumnál áll meg', () => {
    const r = resizeFromCorner(start, 'br', -500, -500, limits);
    expect(r.factor).toBeCloseTo(24 / 100);
  });
  it('a plafonnál megáll', () => {
    expect(resizeFromCorner(start, 'br', 9000, 9000, limits).factor).toBeCloseTo(20);
  });
  it('forgatott keretnél is az átló számít', () => {
    const rotated = { ...start, rotation: 90 };
    // 90°-kal a `br` sarok a bal alsó irányba kerül
    expect(resizeFromCorner(rotated, 'br', -40, 40, limits).factor).toBeCloseTo(1.4);
    expect(resizeFromCorner(rotated, 'br', 40, 40, limits).factor).toBeCloseTo(1);
  });
  it('apró réteg, ami eleve a minimum alatt van, nem ugrik meg fogáskor', () => {
    const tiny = { ...start, halfW: 5, halfH: 5 };
    expect(resizeFromCorner(tiny, 'br', 0, 0, limits).factor).toBeCloseTo(1);
  });
  it('a sorozatos frissítés nem halmozódik: ugyanaz a végállapot, mint egy lépésben', () => {
    let last = 1;
    for (const d of [10, 20, 30, 40]) {
      last = resizeFromCorner(start, 'br', d, d, limits).factor;
    }
    expect(last).toBeCloseTo(resizeFromCorner(start, 'br', 40, 40, limits).factor);
  });
});
