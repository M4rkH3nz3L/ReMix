import type { PathPoint } from '@/types/project';
import { cubic, dist, len, lerpP, sub, type HandleId, type NodeType, type Vec } from './geometry';

// ─────────────────────────────────────────────────────────────────────────────
// Kiértékelés / lekérdezés
// ─────────────────────────────────────────────────────────────────────────────

/** két fogó kollinearitásának küszöbe (keresztszorzat / hosszak) */
const COLIN_EPS = 1e-3;

/** egy szegmens (a→b) pontja `t`-ben — egyenes vagy köbös Bézier. */
export function evalSegment(a: PathPoint, b: PathPoint, t: number): Vec {
  if (!a.h2 && !b.h1) {
    return lerpP(a, b, t);
  }
  return cubic(a, a.h2 ?? a, b.h1 ?? b, b, t);
}

/**
 * A koppintáshoz LEGKÖZELEBBI pont a path-on: melyik szegmens és `t`, illetve a
 * távolság. Szakaszonként mintáz, majd a legjobb környékén finomít — az
 * `insertAnchor` ezt használja, hogy a görbén PONTOSAN a path-ra tegyen pontot.
 */
export function nearestOnPath(
  points: PathPoint[],
  closed: boolean,
  x: number,
  y: number,
  samples = 24
): { seg: number; t: number; point: Vec; dist: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const target = { x, y };
  const segs = closed ? n : n - 1;
  let best = { seg: 0, t: 0, point: { x: points[0].x, y: points[0].y }, dist: Infinity };
  for (let i = 0; i < segs; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const pt = evalSegment(a, b, t);
      const dd = dist(pt, target);
      if (dd < best.dist) best = { seg: i, t, point: pt, dist: dd };
    }
  }
  // helyi finomítás a legjobb minta körül (ternáris szűkítés)
  let lo = Math.max(0, best.t - 1 / samples);
  let hi = Math.min(1, best.t + 1 / samples);
  const a = points[best.seg];
  const b = points[(best.seg + 1) % n];
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(evalSegment(a, b, m1), target) < dist(evalSegment(a, b, m2), target)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = evalSegment(a, b, t);
  return { seg: best.seg, t, point, dist: dist(point, target) };
}

/** a (x,y)-hoz `tol`-on belüli horgony indexe (a legközelebbi), vagy -1. */
export function anchorIndexAt(points: PathPoint[], x: number, y: number, tol = 0.02): number {
  let best = -1;
  let bestD = tol;
  points.forEach((p, i) => {
    const d = dist(p, { x, y });
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** a (x,y)-hoz `tol`-on belüli FOGÓ (horgony + h1/h2), vagy null. */
export function handleAt(
  points: PathPoint[],
  x: number,
  y: number,
  tol = 0.02
): { index: number; handle: HandleId } | null {
  let best: { index: number; handle: HandleId } | null = null;
  let bestD = tol;
  points.forEach((p, i) => {
    (['h1', 'h2'] as const).forEach((h) => {
      const v = p[h];
      if (v) {
        const d = dist(v, { x, y });
        if (d <= bestD) {
          bestD = d;
          best = { index: i, handle: h };
        }
      }
    });
  });
  return best;
}

/** egy horgony node-típusa a geometriából (fogó-állás alapján). */
export function nodeType(p: PathPoint): NodeType {
  const hasIn = !!p.h1;
  const hasOut = !!p.h2;
  if (!hasIn && !hasOut) return 'corner';
  if (hasIn && hasOut) {
    const inV = sub(p.h1!, p);
    const outV = sub(p.h2!, p);
    const li = len(inV);
    const lo = len(outV);
    if (li < 1e-6 || lo < 1e-6) return 'broken';
    const cross = inV.x * outV.y - inV.y * outV.x;
    const dot = inV.x * outV.x + inV.y * outV.y;
    const colinearOpposite = Math.abs(cross) < COLIN_EPS * li * lo && dot < 0;
    if (colinearOpposite) return Math.abs(li - lo) < 1e-4 ? 'mirrored' : 'smooth';
    return 'broken';
  }
  return 'broken'; // csak az egyik fogó él
}
