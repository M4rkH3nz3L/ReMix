import {
  pathBounds,
  pathData,
  polylinePoints,
  simplifyPath,
  smoothToBezier,
  toBoxSpace,
  type Point,
} from '@/lib/draw';
import type { PathPoint } from '@/types/project';

// ✏️ A rajz/forma geometria (szabadkézi vonal → forma-réteg; a preview ÉS a
// render közös magja) regressziós pajzsa. Pure → tesztelhető.

describe('simplifyPath — Ramer–Douglas–Peucker', () => {
  it('≤2 pont → változatlan másolat', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPath(pts)).toEqual(pts);
    expect(simplifyPath(pts)).not.toBe(pts); // új tömb
  });

  it('a tűrésen belüli közbenső pontot eldobja, a végpontokat tartja', () => {
    // a középső 0.001-re van az egyenestől (tol 0.004) → eldobható
    const out = simplifyPath([{ x: 0, y: 0 }, { x: 0.5, y: 0.001 }, { x: 1, y: 0 }], 0.004);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  });

  it('a tűrésen KÍVÜLi csúcsot megtartja', () => {
    const out = simplifyPath([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }], 0.004);
    expect(out).toHaveLength(3);
  });
});

describe('pathBounds — befoglaló doboz + vonal-margó', () => {
  it('üres → null', () => {
    expect(pathBounds([], 1)).toBeNull();
  });

  it('középpont + méret margó nélkül (strokeWidth 0)', () => {
    const b = pathBounds([{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }], 0)!;
    expect(b.x).toBeCloseTo(0.3);
    expect(b.y).toBeCloseTo(0.4);
    expect(b.w).toBeCloseTo(0.2);
    expect(b.h).toBeCloseTo(0.2);
  });

  it('egyenes (nulla-magas) vonal → a doboz sosem nulla (min 0.01)', () => {
    const b = pathBounds([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 0)!;
    expect(b.h).toBe(0.01);
  });

  it('a vízszintes margó az aspect szerint skáláz', () => {
    const narrow = pathBounds([{ x: 0.5, y: 0.5 }], 10, 0.3)!;
    const wide = pathBounds([{ x: 0.5, y: 0.5 }], 10, 1)!;
    expect(narrow.w).toBeGreaterThan(wide.w); // keskenyebb aspect → nagyobb padX
  });
});

describe('toBoxSpace — vászon → doboz saját 0–1 tere', () => {
  it('a doboz sarkai 0..1-re képződnek', () => {
    const bounds = { x: 0.3, y: 0.4, w: 0.2, h: 0.2 };
    const near = (p: Point, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 3);
      expect(p.y).toBeCloseTo(y, 3);
    };
    near(toBoxSpace([{ x: 0.2, y: 0.3 }], bounds)[0], 0, 0);
    near(toBoxSpace([{ x: 0.3, y: 0.4 }], bounds)[0], 0.5, 0.5);
    near(toBoxSpace([{ x: 0.4, y: 0.5 }], bounds)[0], 1, 1);
  });
});

describe('polylinePoints — SVG polyline string', () => {
  it('pixelre skáláz, 1 tizedes, szóközzel elválasztva', () => {
    expect(polylinePoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], 100, 50)).toBe('0.0,0.0 100.0,50.0');
  });
});

describe('pathData — SVG path d (Bézier-tudatos)', () => {
  it('üres → üres string', () => {
    expect(pathData([], 10, 10)).toBe('');
  });

  it('fogó nélkül egyenes szegmensek (L)', () => {
    const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(pathData(pts, 10, 10)).toBe('M0.00,0.00L10.00,10.00');
  });

  it('fogóval köbös görbe (C)', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0, h2: { x: 0.2, y: 0 } },
      { x: 1, y: 1, h1: { x: 0.8, y: 1 } },
    ];
    expect(pathData(pts, 10, 10)).toBe('M0.00,0.00C2.00,0.00 8.00,10.00 10.00,10.00');
  });

  it('zárt path → Z, és a wrap-szegmens is rajzolódik', () => {
    const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const d = pathData(pts, 10, 10, true);
    expect(d.startsWith('M0.00,0.00')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('smoothToBezier — Catmull-Rom → fogók', () => {
  it('<3 pont → sima pont (fogó nélkül)', () => {
    const out = smoothToBezier([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('3+ pont → minden horgony kap h1/h2 fogót', () => {
    const out = smoothToBezier([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.h1).toBeDefined();
      expect(p.h2).toBeDefined();
    }
  });
});
