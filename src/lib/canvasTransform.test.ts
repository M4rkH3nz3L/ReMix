import {
  hasCustomAnchor,
  hasSkew,
  shearPoint,
  skewTransformEntries,
  skewUnitCorners,
  transformOrigin,
} from '@/lib/canvasTransform';
import type { CanvasTransform } from '@/types/project';

const base: CanvasTransform = { scale: 1, x: 0, y: 0 };

describe('transformOrigin (anchor → %, audit §6.6)', () => {
  it('alapértelmezett közép: 50% 50%', () => {
    expect(transformOrigin(undefined)).toBe('50% 50%');
    expect(transformOrigin(base)).toBe('50% 50%');
  });
  it('egyéni anchor', () => {
    expect(transformOrigin({ ...base, anchorX: 0, anchorY: 1 })).toBe('0% 100%');
    expect(transformOrigin({ ...base, anchorX: 0.25, anchorY: 0.75 })).toBe('25% 75%');
  });
  it('nincs csúnya záró nulla', () => {
    expect(transformOrigin({ ...base, anchorX: 0.3, anchorY: 0.5 })).toBe('30% 50%');
  });
});

describe('hasCustomAnchor', () => {
  it('false alapértelmezettre', () => {
    expect(hasCustomAnchor(undefined)).toBe(false);
    expect(hasCustomAnchor(base)).toBe(false);
    expect(hasCustomAnchor({ ...base, anchorX: 0.5, anchorY: 0.5 })).toBe(false);
  });
  it('true nem-közép anchorra', () => {
    expect(hasCustomAnchor({ ...base, anchorX: 0 })).toBe(true);
    expect(hasCustomAnchor({ ...base, anchorY: 0.9 })).toBe(true);
  });
});

describe('hasSkew + skewTransformEntries', () => {
  it('nincs skew → üres', () => {
    expect(hasSkew(base)).toBe(false);
    expect(skewTransformEntries(base)).toEqual([]);
    expect(skewTransformEntries({ ...base, skewX: 0, skewY: 0 })).toEqual([]);
  });
  it('csak a nemnulla tengelyek kerülnek be, deg-ben', () => {
    expect(hasSkew({ ...base, skewX: 10 })).toBe(true);
    expect(skewTransformEntries({ ...base, skewX: 10 })).toEqual([{ skewX: '10deg' }]);
    expect(skewTransformEntries({ ...base, skewY: -5 })).toEqual([{ skewY: '-5deg' }]);
    expect(skewTransformEntries({ ...base, skewX: 10, skewY: 5 })).toEqual([
      { skewX: '10deg' },
      { skewY: '5deg' },
    ]);
  });
});

describe('shearPoint (nyírás-matek)', () => {
  it('0 skew = identitás', () => {
    expect(shearPoint(0.3, 0.7, 0, 0)).toEqual({ x: 0.3, y: 0.7 });
  });
  it('skewX=45° → x += y·tan(45)=y', () => {
    const p = shearPoint(0, 1, 45, 0);
    expect(p.x).toBeCloseTo(1); // 0 + 1*1
    expect(p.y).toBeCloseTo(1);
  });
  it('skewY=45° → y += x·tan(45)=x', () => {
    const p = shearPoint(1, 0, 0, 45);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1); // 0 + 1*1
  });
});

describe('skewUnitCorners (render perspektíva-sarkok)', () => {
  it('0 skew → az egységnégyzet sarkai', () => {
    expect(skewUnitCorners(0, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });
  it('skewX=45° → a lenti sarkok jobbra tolódnak (y·tan45)', () => {
    const c = skewUnitCorners(45, 0);
    // bal-fent (0,0), jobb-fent (1,0) változatlan; bal-lent (0,1)→(1,1), jobb-lent (1,1)→(2,1)
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[3].x).toBeCloseTo(1); // bal-lent x: 0 + 1*1
    expect(c[2].x).toBeCloseTo(2); // jobb-lent x: 1 + 1*1
  });
});
