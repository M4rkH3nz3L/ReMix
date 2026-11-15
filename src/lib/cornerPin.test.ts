import { DEFAULT_CORNERS, applyMatrix, cornerPinMatrix, isIdentityCorners, normalizeCorners, squareToQuad, type Corners } from '@/lib/cornerPin';

/* eslint-disable @typescript-eslint/no-require-imports */
const server = require('../../server/imageFilters');

const quad: Corners = [{ x: 0.1, y: 0.05 }, { x: 0.95, y: 0.2 }, { x: 0.85, y: 0.9 }, { x: 0.05, y: 0.8 }];

describe('🔲 S18: 4-sarkos perspektíva', () => {
  it('a homográfia a doboz sarkait a négyszög sarkaira viszi (perspektivikus négyszögre is)', () => {
    const m = cornerPinMatrix(quad, 300, 200);
    const src = [[0, 0], [300, 0], [300, 200], [0, 200]];
    src.forEach(([x, y], i) => {
      const p = applyMatrix(m, x, y);
      expect(p.x).toBeCloseTo(quad[i].x * 300, 6);
      expect(p.y).toBeCloseTo(quad[i].y * 200, 6);
    });
    // nem affin: a perspektív sor nem nulla
    expect(Math.abs(squareToQuad(quad)[6]) + Math.abs(squareToQuad(quad)[7])).toBeGreaterThan(0);
  });

  it('az alap négyes identitás; a sarkok a dobozon belül maradnak', () => {
    expect(isIdentityCorners(DEFAULT_CORNERS)).toBe(true);
    expect(isIdentityCorners(quad)).toBe(false);
    const m = cornerPinMatrix(DEFAULT_CORNERS, 100, 50);
    expect(applyMatrix(m, 37, 21)).toEqual({ x: 37, y: 21 });
    expect(normalizeCorners([{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])![0].x).toBe(0);
    expect(normalizeCorners([{ x: 0, y: 0 }])).toBeNull();
  });

  it('a szerver szűrője: identitásnál üres, különben átlátszó kerettel és visszavágással', () => {
    expect(server.cornerPinFilter(DEFAULT_CORNERS, 200, 100)).toBe('');
    const f = server.cornerPinFilter(quad, 200, 100);
    expect(f).toContain('pad=iw+');
    expect(f).toContain('sense=destination');
    expect(f).toContain('crop=200:100');
  });
});
