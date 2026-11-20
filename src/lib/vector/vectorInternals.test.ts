import { arcToCubics } from './arc';
import { clonePt, cubic, dist, len, lerpP, norm, round, rp, scaleV, sub, add } from './geometry';

// A `vectorPath` belső moduljai (REFACTOR): a publikus felületen át csak közvetve tesztelt
// segédek viselkedése rögzítve.

describe('vector/geometry — vektor-segédek', () => {
  it('a kerekítés 4 tizedesre megy', () => {
    expect(round(0.123456)).toBe(0.1235);
    expect(round(-0.00004)).toBe(-0);
    expect(round(1)).toBe(1);
  });

  it('alap vektor-műveletek', () => {
    expect(sub({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    expect(add({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ x: 4, y: 5 });
    expect(scaleV({ x: 3, y: -4 }, 2)).toEqual({ x: 6, y: -8 });
    expect(len({ x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(lerpP({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.25)).toEqual({ x: 2.5, y: 5 });
  });

  it('a nullvektor normálása nem oszt nullával (1e-9 osztó)', () => {
    expect(norm({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('köbös Bézier a végpontokban a horgonyt adja', () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 1, y: 0 };
    expect(cubic(p0, { x: 0, y: 1 }, { x: 1, y: 1 }, p3, 0)).toEqual(p0);
    expect(cubic(p0, { x: 0, y: 1 }, { x: 1, y: 1 }, p3, 1)).toEqual(p3);
    expect(cubic(p0, { x: 0, y: 1 }, { x: 1, y: 1 }, p3, 0.5)).toEqual({ x: 0.5, y: 0.75 });
  });

  it('a pont-másolat nem szór be undefined fogót, és mély másolat', () => {
    const p = { x: 1, y: 2, h2: { x: 3, y: 4 } };
    const q = clonePt(p);
    expect(q).toEqual(p);
    expect(Object.keys(q)).toEqual(['x', 'y', 'h2']);
    expect(q.h2).not.toBe(p.h2);
  });

  it('a kerekített pont a meglévő fogókat is kerekíti', () => {
    expect(rp({ x: 0.123456, y: 1, h1: { x: 0.99999, y: 0 } })).toEqual({ x: 0.1235, y: 1, h1: { x: 1, y: 0 } });
    expect(Object.keys(rp({ x: 0, y: 0 }))).toEqual(['x', 'y']);
  });
});

describe('vector/arc — ív → köbös Bézier', () => {
  it('nulla sugár vagy azonos végpont → egyetlen egyenes-szerű szegmens', () => {
    expect(arcToCubics(0, 0, 0, 5, 0, 0, 1, 10, 10)).toEqual([
      { c1: { x: 0, y: 0 }, c2: { x: 10, y: 10 }, end: { x: 10, y: 10 } },
    ]);
    expect(arcToCubics(5, 5, 3, 3, 0, 0, 1, 5, 5)).toHaveLength(1);
  });

  it('félkör ≤90°-os darabokra bomlik, a vége pontosan a célpont', () => {
    const segs = arcToCubics(0, 0, 10, 10, 0, 0, 1, 20, 0);
    expect(segs).toHaveLength(2);
    const end = segs[segs.length - 1].end;
    expect(end.x).toBeCloseTo(20, 9);
    expect(end.y).toBeCloseTo(0, 9);
    // söprés=1: a (0,0)→(20,0) félkör a középpont (10,0) negatív-y oldalán megy
    expect(segs[0].end.y).toBeCloseTo(-10, 9);
  });

  it('a túl kicsi sugár a lambda-szabállyal felskálázódik', () => {
    const segs = arcToCubics(0, 0, 1, 1, 0, 0, 0, 20, 0);
    expect(segs).toHaveLength(2);
    // söprés=0 → a másik oldal
    expect(segs[0].end.y).toBeCloseTo(10, 9);
  });

  it('nagyív-flag → 3/4 kör 3 darabban', () => {
    expect(arcToCubics(10, 0, 10, 10, 0, 1, 1, 0, 10)).toHaveLength(3);
    expect(arcToCubics(10, 0, 10, 10, 0, 0, 1, 0, 10)).toHaveLength(1);
  });

  it('negatív sugár abszolút értékkel számol', () => {
    expect(arcToCubics(0, 0, -10, -10, 0, 0, 1, 20, 0)).toEqual(arcToCubics(0, 0, 10, 10, 0, 0, 1, 20, 0));
  });
});
