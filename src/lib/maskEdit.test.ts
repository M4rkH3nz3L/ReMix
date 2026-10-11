import {
  insertVertex,
  maskBox,
  maskFromStroke,
  moveMask,
  moveVertex,
  pointsBounds,
  removeVertex,
  resizeMask,
  smoothClosedPoints,
} from '@/lib/maskEdit';
import type { ClipMask } from '@/types/project';

// ✂️ A vászon-maszk szerkesztés (szabadkézi/rotoszkóp poligon; a preview ÉS a
// render közös magja) regressziós pajzsa. Pure → tesztelhető.

const poly = (points: { x: number; y: number }[]): ClipMask =>
  ({ shape: 'polygon', points, ...pointsBounds(points)!, feather: 0.04 } as ClipMask);

const TRI = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }];

describe('pointsBounds', () => {
  it('üres → null', () => {
    expect(pointsBounds([])).toBeNull();
  });
  it('középpont + méret', () => {
    expect(pointsBounds(TRI)).toEqual({ x: 0.5, y: 0.5, w: 0.6, h: 0.6 });
  });
  it('pici pontfelhő → MIN_SIZE (0.04) alsó korlát', () => {
    const b = pointsBounds([{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.501 }])!;
    expect(b.w).toBe(0.04);
    expect(b.h).toBe(0.04);
  });
});

describe('moveMask — a maszk nem léphet ki a vászonról', () => {
  it('poligon: az eltolás a legszélső pontra clampel', () => {
    const m = moveMask(poly(TRI), 0.5, 0); // max x 0.8 → csak +0.2 fér
    const xs = m.points!.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(1, 3);
    expect(Math.min(...xs)).toBeCloseTo(0.4, 3);
  });
  it('nem-poligon (rect): a fél-méret szerint clampel', () => {
    const m = moveMask({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.4, h: 0.4 } as ClipMask, 0.5, 0);
    expect(m.x).toBeCloseTo(0.8, 3); // 1 - w/2
  });
});

describe('resizeMask — a középpont körül nő/zsugorodik', () => {
  it('rect: növelés + a középpont bent marad', () => {
    const m = resizeMask({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.4, h: 0.4 } as ClipMask, 0.2, 0.2);
    expect(m.w).toBeCloseTo(0.6, 3);
    expect(m.h).toBeCloseTo(0.6, 3);
    expect(m.x).toBeCloseTo(0.5, 3);
  });
  it('MIN_SIZE alá nem megy', () => {
    const m = resizeMask({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.4, h: 0.4 } as ClipMask, -1, -1);
    expect(m.w).toBe(0.04);
  });
  it('poligon: a pontok a középpont körül skálázódnak (alak marad)', () => {
    const m = resizeMask(poly(TRI), 0.6, 0); // w 0.6 → 1.2 cél, de ≤1
    const b = pointsBounds(m.points!)!;
    expect(b.w).toBeGreaterThan(0.6);
    expect(b.x).toBeCloseTo(0.5, 2); // középpont marad
  });
});

describe('moveVertex / insertVertex / removeVertex', () => {
  it('moveVertex: egy csúcs áthelyezése + bounds újraszámolva; rossz index → változatlan', () => {
    const m = moveVertex(poly(TRI), 0, 0.1, 0.1);
    expect(m.points![0]).toEqual({ x: 0.1, y: 0.1 });
    expect(m.x).toBeCloseTo(pointsBounds(m.points!)!.x, 5);
    expect(moveVertex(poly(TRI), 9, 0.1, 0.1)).toEqual(poly(TRI)); // index tartományon kívül
  });
  it('insertVertex: új csúcs a legközelebbi élre; nem-poligon → változatlan', () => {
    const m = insertVertex(poly(TRI), 0.5, 0.2); // a felső él közelébe
    expect(m.points).toHaveLength(4);
    const rect = { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.4, h: 0.4 } as ClipMask;
    expect(insertVertex(rect, 0.5, 0.5)).toBe(rect);
  });
  it('removeVertex: töröl, de min. 3 csúcs marad', () => {
    const quad = poly([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }]);
    expect(removeVertex(quad, 0).points).toHaveLength(3);
    expect(removeVertex(poly(TRI), 0).points).toHaveLength(3); // 3-nál nem töröl tovább
  });
});

describe('maskBox', () => {
  it('poligon → a pontok befoglaló doboza; rect → a saját x/y/w/h', () => {
    expect(maskBox(poly(TRI))).toEqual({ x: 0.5, y: 0.5, w: 0.6, h: 0.6 });
    const rect = { shape: 'rectangle', x: 0.3, y: 0.4, w: 0.2, h: 0.1 } as ClipMask;
    expect(maskBox(rect)).toEqual({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 });
  });
});

describe('maskFromStroke — szabadkézi pontsor → poligon-maszk', () => {
  it('<3 pont → null', () => {
    expect(maskFromStroke([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }])).toBeNull();
  });
  it('túl kicsi firka → null', () => {
    expect(maskFromStroke([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.5, y: 0.51 }])).toBeNull();
  });
  it('érvényes körvonal → polygon + bounds + feather', () => {
    const m = maskFromStroke(TRI, 0.06)!;
    expect(m.shape).toBe('polygon');
    expect(m.points).toHaveLength(3);
    expect(m.feather).toBe(0.06);
    expect(m.w).toBeCloseTo(0.6, 3);
  });
  it('a pontok a vászonra [0,1] szorítódnak', () => {
    const m = maskFromStroke([{ x: -1, y: 0.2 }, { x: 2, y: 0.2 }, { x: 0.5, y: 0.9 }])!;
    for (const p of m.points!) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });
});

describe('smoothClosedPoints — Catmull-Rom sűrítés', () => {
  it('<3 pont → változatlan', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(smoothClosedPoints(pts)).toBe(pts);
  });
  it('sűrít, de a 64-es sapka alatt marad', () => {
    const out = smoothClosedPoints(TRI, 4);
    expect(out.length).toBeGreaterThan(TRI.length);
    expect(out.length).toBeLessThanOrEqual(64);
  });
});
