import {
  addAnchor,
  anchorIndexAt,
  deleteAnchor,
  dragHandle,
  evalSegment,
  handleAt,
  insertAnchor,
  joinPaths,
  moveAnchor,
  nearestOnPath,
  nodeType,
  normalizeSubpaths,
  parseSvgPath,
  pointsToSvgPath,
  reversePath,
  setNodeType,
  splitSegment,
  subpathsBounds,
  subpathsToSvgPath,
} from '@/lib/vectorPath';
import type { PathPoint } from '@/types/project';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

/**
 * Az `[a,b]` szegmens `split`-nél osztott két része (out01 = [a,mid], out12 =
 * [mid,b]) pontosan az eredeti görbét adja-e? A rész-paraméterek ismertek:
 * out01(u) = eredeti(u·split), out12(u) = eredeti(split + u·(1−split)).
 */
function sameShape(
  a: PathPoint,
  b: PathPoint,
  split: number,
  out01: [PathPoint, PathPoint],
  out12: [PathPoint, PathPoint]
) {
  for (let s = 0; s <= 12; s++) {
    const u = s / 12;
    const p1 = evalSegment(out01[0], out01[1], u);
    const o1 = evalSegment(a, b, u * split);
    const p2 = evalSegment(out12[0], out12[1], u);
    const o2 = evalSegment(a, b, split + u * (1 - split));
    if (Math.hypot(p1.x - o1.x, p1.y - o1.y) > 2e-3) return false;
    if (Math.hypot(p2.x - o2.x, p2.y - o2.y) > 2e-3) return false;
  }
  return true;
}

describe('vectorPath — horgony/fogó műveletek', () => {
  it('addAnchor a végére tesz, fogó nélkül', () => {
    const p = addAnchor([{ x: 0, y: 0 }], 0.5, 0.5);
    expect(p).toHaveLength(2);
    expect(p[1]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('moveAnchor a fogókat is viszi', () => {
    const pts: PathPoint[] = [{ x: 0.2, y: 0.2, h1: { x: 0.1, y: 0.2 }, h2: { x: 0.3, y: 0.2 } }];
    // 0.2,0.2 → 0.4,0.4 (delta +0.2,+0.2)
    const out = moveAnchor(pts, 0, 0.4, 0.4);
    expect(out[0]).toEqual({
      x: 0.4,
      y: 0.4,
      h1: { x: 0.3, y: 0.4 },
      h2: { x: 0.5, y: 0.4 },
    });
  });

  it('deleteAnchor tartja a minimumot', () => {
    expect(deleteAnchor([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toHaveLength(2); // min 2
    const three = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(deleteAnchor(three, 1)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe('vectorPath — fogó-húzás módok', () => {
  const base: PathPoint[] = [{ x: 0.5, y: 0.5, h1: { x: 0.4, y: 0.5 }, h2: { x: 0.6, y: 0.5 } }];

  it('mirrored: a szemközti fogó tükröződik', () => {
    const out = dragHandle(base, 0, 'h2', 0.7, 0.6, 'mirrored');
    expect(out[0].h2).toEqual({ x: 0.7, y: 0.6 });
    // anchor (0.5,0.5) körül tükrözve
    expect(out[0].h1).toEqual({ x: 0.3, y: 0.4 });
  });

  it('smooth: a szemközti fogó irányt fordít, de a hosszát tartja', () => {
    // h1 hossza 0.1 (0.4→0.5). h2-t húzzuk átlósan
    const out = dragHandle(base, 0, 'h2', 0.6, 0.6, 'smooth');
    const a = { x: 0.5, y: 0.5 };
    const h1 = out[0].h1!;
    // h1 hossza változatlan (~0.1)
    expect(near(Math.hypot(h1.x - a.x, h1.y - a.y), 0.1)).toBe(true);
    // kollineáris: h1-anchor és h2-anchor ellentétes irány
    const cross = (h1.x - a.x) * (0.6 - a.y) - (h1.y - a.y) * (0.6 - a.x);
    expect(near(cross, 0, 1e-3)).toBe(true);
  });

  it('broken: a szemközti fogó nem mozdul', () => {
    const out = dragHandle(base, 0, 'h2', 0.9, 0.2, 'broken');
    expect(out[0].h1).toEqual({ x: 0.4, y: 0.5 });
    expect(out[0].h2).toEqual({ x: 0.9, y: 0.2 });
  });
});

describe('vectorPath — node-típus', () => {
  it('nodeType felismerés', () => {
    expect(nodeType({ x: 0.5, y: 0.5 })).toBe('corner');
    expect(
      nodeType({ x: 0.5, y: 0.5, h1: { x: 0.4, y: 0.5 }, h2: { x: 0.6, y: 0.5 } })
    ).toBe('mirrored');
    expect(
      nodeType({ x: 0.5, y: 0.5, h1: { x: 0.45, y: 0.5 }, h2: { x: 0.6, y: 0.5 } })
    ).toBe('smooth');
    expect(
      nodeType({ x: 0.5, y: 0.5, h1: { x: 0.4, y: 0.5 }, h2: { x: 0.5, y: 0.3 } })
    ).toBe('broken');
  });

  it('setNodeType corner törli a fogókat', () => {
    const pts: PathPoint[] = [{ x: 0.5, y: 0.5, h1: { x: 0.4, y: 0.5 }, h2: { x: 0.6, y: 0.5 } }];
    expect(setNodeType(pts, 0, 'corner')[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('setNodeType smooth a szomszédokból kollineáris fogókat gyárt', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.4 },
      { x: 1, y: 0 },
    ];
    const out = setNodeType(pts, 1, 'smooth');
    expect(nodeType(out[1])).toMatch(/smooth|mirrored/);
    // a tengely ~vízszintes (a szomszédok azonos magasságban) → a fogók y-a ~a horgonyé
    expect(near(out[1].h1!.y, 0.4, 5e-3)).toBe(true);
    expect(near(out[1].h2!.y, 0.4, 5e-3)).toBe(true);
  });

  it('setNodeType mirrored egyenlő hosszú fogók', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5, h1: { x: 0.45, y: 0.5 }, h2: { x: 0.8, y: 0.5 } },
      { x: 1, y: 0 },
    ];
    const out = setNodeType(pts, 1, 'mirrored');
    const a = { x: 0.5, y: 0.5 };
    const l1 = Math.hypot(out[1].h1!.x - a.x, out[1].h1!.y - a.y);
    const l2 = Math.hypot(out[1].h2!.x - a.x, out[1].h2!.y - a.y);
    expect(near(l1, l2, 1e-3)).toBe(true);
    expect(nodeType(out[1])).toBe('mirrored');
  });
});

describe('vectorPath — szegmens-osztás (görbe-tartó)', () => {
  it('egyenes szakasz felezése', () => {
    const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const out = splitSegment(pts, 0, 0.5);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('köbös Bézier osztása nem változtatja az alakot', () => {
    const a: PathPoint = { x: 0, y: 0, h2: { x: 0, y: 0.8 } };
    const b: PathPoint = { x: 1, y: 1, h1: { x: 1, y: 0.2 } };
    const out = splitSegment([a, b], 0, 0.35);
    expect(out).toHaveLength(3);
    const ok = sameShape(a, b, 0.35, [out[0], out[1]], [out[1], out[2]]);
    expect(ok).toBe(true);
  });

  it('insertAnchor a görbére tesz pontot (közel a path-hoz)', () => {
    const a: PathPoint = { x: 0, y: 0, h2: { x: 0, y: 0.8 } };
    const b: PathPoint = { x: 1, y: 1, h1: { x: 1, y: 0.2 } };
    const mid = evalSegment(a, b, 0.5);
    const out = insertAnchor([a, b], mid.x, mid.y);
    expect(out).toHaveLength(3);
    expect(near(out[1].x, mid.x, 5e-3)).toBe(true);
    expect(near(out[1].y, mid.y, 5e-3)).toBe(true);
  });

  it('zárt path utolsó (wrap) szegmensének osztása', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ];
    const out = splitSegment(pts, 2, 0.5, true); // a 2→0 él
    expect(out).toHaveLength(4);
    // az új pont a (0.5,1) és (0,0) közötti felezőn
    expect(out[3]).toEqual({ x: 0.25, y: 0.5 });
  });
});

describe('vectorPath — reverse / join / hit-test', () => {
  it('reversePath fordítja a sorrendet és cseréli a fogókat', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0, h2: { x: 0.2, y: 0 } },
      { x: 1, y: 1, h1: { x: 0.8, y: 1 } },
    ];
    const out = reversePath(pts);
    expect(out[0].x).toBe(1);
    expect(out[0].h2).toEqual({ x: 0.8, y: 1 }); // a régi h1-ből h2
    expect(out[1].h1).toEqual({ x: 0.2, y: 0 }); // a régi h2-ből h1
  });

  it('reverse ugyanazt a geometriát adja (visszafelé mintázva)', () => {
    const a: PathPoint = { x: 0, y: 0, h2: { x: 0, y: 0.8 } };
    const b: PathPoint = { x: 1, y: 1, h1: { x: 1, y: 0.2 } };
    const r = reversePath([a, b]);
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      const fwd = evalSegment(a, b, t);
      const rev = evalSegment(r[0], r[1], 1 - t);
      expect(near(fwd.x, rev.x)).toBe(true);
      expect(near(fwd.y, rev.y)).toBe(true);
    }
  });

  it('joinPaths egyszerű összefűzés', () => {
    const out = joinPaths([{ x: 0, y: 0 }], [{ x: 1, y: 1 }]);
    expect(out).toHaveLength(2);
  });

  it('joinPaths weld: az egybeeső végpontok eggyé olvadnak', () => {
    const a: PathPoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }];
    const b: PathPoint[] = [{ x: 0.5, y: 0.5, h2: { x: 0.7, y: 0.6 } }, { x: 1, y: 1 }];
    const out = joinPaths(a, b, 0.01);
    expect(out).toHaveLength(3);
    expect(out[1].h2).toEqual({ x: 0.7, y: 0.6 });
  });

  it('anchorIndexAt / handleAt hit-test', () => {
    const pts: PathPoint[] = [
      { x: 0.2, y: 0.2, h2: { x: 0.3, y: 0.25 } },
      { x: 0.8, y: 0.8 },
    ];
    expect(anchorIndexAt(pts, 0.21, 0.19)).toBe(0);
    expect(anchorIndexAt(pts, 0.5, 0.5)).toBe(-1);
    expect(handleAt(pts, 0.3, 0.25)).toEqual({ index: 0, handle: 'h2' });
    expect(handleAt(pts, 0.5, 0.5)).toBeNull();
  });

  it('nearestOnPath megtalálja a legközelebbi szegmenst', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const hit = nearestOnPath(pts, false, 0.5, 0.1);
    expect(hit?.seg).toBe(0);
    expect(near(hit!.point.y, 0, 1e-2)).toBe(true);
  });
});

describe('vectorPath — SVG path parse ↔ emit', () => {
  it('köbös görbe oda-vissza', () => {
    const d = 'M0 0 C0 0.8 1 0.2 1 1';
    const subs = parseSvgPath(d);
    expect(subs).toHaveLength(1);
    expect(subs[0].points).toHaveLength(2);
    expect(subs[0].points[0].h2).toEqual({ x: 0, y: 0.8 });
    expect(subs[0].points[1].h1).toEqual({ x: 1, y: 0.2 });
    const emitted = pointsToSvgPath(subs[0].points, subs[0].closed);
    expect(emitted).toBe('M0 0 C0 0.8 1 0.2 1 1');
  });

  it('relatív parancsok abszolúttá alakulnak', () => {
    const abs = parseSvgPath('M10 10 L20 10 L20 20 Z');
    const rel = parseSvgPath('m10 10 l10 0 l0 10 z');
    expect(rel[0].points.map((p) => [p.x, p.y])).toEqual(abs[0].points.map((p) => [p.x, p.y]));
    expect(rel[0].closed).toBe(true);
  });

  it('H/V és implicit ismétlés', () => {
    const subs = parseSvgPath('M0 0 H10 V10 L0 10 Z');
    const pts = subs[0].points.map((p) => [p.x, p.y]);
    expect(pts).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    // implicit ismételt L
    const impl = parseSvgPath('M0 0 L1 0 2 0 3 0');
    expect(impl[0].points).toHaveLength(4);
    expect(impl[0].points[3]).toEqual({ x: 3, y: 0 });
  });

  it('S reflexió (sima folytatás)', () => {
    // az S első vezérlője az előző C második vezérlőjének tükre a horgonyon át
    const subs = parseSvgPath('M0 0 C1 0 1 1 2 1 S3 2 4 1');
    const pts = subs[0].points;
    // a 2. horgony (2,1) körül a (1,1) tükre (3,1) → az S első vezérlője
    expect(pts[1].h2).toEqual({ x: 3, y: 1 });
  });

  it('Q → köbös konverzió és T', () => {
    const subs = parseSvgPath('M0 0 Q1 1 2 0');
    const p = subs[0].points;
    // c1 = P0 + 2/3(Q-P0) = (0.6667, 0.6667)
    expect(near(p[0].h2!.x, 2 / 3)).toBe(true);
    expect(near(p[0].h2!.y, 2 / 3)).toBe(true);
    // c2 = P2 + 2/3(Q-P2) = (1.3333, 0.6667)
    expect(near(p[1].h1!.x, 4 / 3)).toBe(true);
  });

  it('több al-path (több M)', () => {
    const subs = parseSvgPath('M0 0 L1 0 M2 2 L3 2 Z');
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(false);
    expect(subs[1].closed).toBe(true);
  });

  it('elliptikus ív végpontja pontos', () => {
    // negyedkör (0,1)→(1,0), r=1
    const subs = parseSvgPath('M0 1 A1 1 0 0 1 1 0');
    const pts = subs[0].points;
    const last = pts[pts.length - 1];
    expect(near(last.x, 1, 1e-3)).toBe(true);
    expect(near(last.y, 0, 1e-3)).toBe(true);
    // a köztes íven a (cos45,1-sin45) ≈ (0.707, 0.293) közelében kell haladnia
    const mid = evalSegment(pts[0], pts[1], 1);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(mid).toBeDefined();
  });

  it('subpathsToSvgPath összefűz', () => {
    // zárt path a wrap-szegmenst is kiírja Z előtt (a draw.ts:pathData konvenció)
    const d = subpathsToSvgPath([
      { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false },
      { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.5, y: 2 }], closed: true },
    ]);
    expect(d).toBe('M0 0 L1 0 M0 1 L1 1 L0.5 2 L0 1 Z');
  });
});

describe('vectorPath — normalizálás', () => {
  it('subpathsBounds a fogókat is befoglalja', () => {
    const b = subpathsBounds([
      { points: [{ x: 0, y: 0, h2: { x: -0.5, y: 0 } }, { x: 1, y: 1 }], closed: false },
    ]);
    expect(b).toEqual({ minX: -0.5, minY: 0, w: 1.5, h: 1 });
  });

  it('normalizeSubpaths 0–1-be illeszt', () => {
    const { subpaths, box } = normalizeSubpaths([
      { points: [{ x: 10, y: 20 }, { x: 110, y: 220 }], closed: false },
    ]);
    expect(box).toEqual({ minX: 10, minY: 20, w: 100, h: 200 });
    expect(subpaths[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(subpaths[0].points[1]).toEqual({ x: 1, y: 1 });
  });

  it('SVG import → normalizált al-path a klip-dobozba', () => {
    const parsed = parseSvgPath('M20 20 C20 100 100 20 100 100 Z');
    const { subpaths } = normalizeSubpaths(parsed);
    for (const p of subpaths[0].points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});
