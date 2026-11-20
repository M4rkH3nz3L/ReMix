import type { PathPoint } from '@/types/project';
import { add, clonePt, dist, len, lerpP, norm, round, rp, scaleV, sub, type HandleId, type NodeType, type Vec } from './geometry';
import { nearestOnPath } from './query';

// ─────────────────────────────────────────────────────────────────────────────
// Szerkesztő-műveletek
// ─────────────────────────────────────────────────────────────────────────────

/** új horgony a path VÉGÉRE (toll-rajzolás), fogók nélkül. */
export function addAnchor(points: PathPoint[], x: number, y: number): PathPoint[] {
  return [...points.map(clonePt), rp({ x, y })];
}

/** horgony áthelyezése — a FOGÓI is vele mennek (abszolút pozíciók). */
export function moveAnchor(points: PathPoint[], index: number, x: number, y: number): PathPoint[] {
  if (index < 0 || index >= points.length) return points;
  const p = points[index];
  const dx = x - p.x;
  const dy = y - p.y;
  return points.map((q, i) => {
    if (i !== index) return clonePt(q);
    const out: PathPoint = { x: round(x), y: round(y) };
    if (q.h1) out.h1 = { x: round(q.h1.x + dx), y: round(q.h1.y + dy) };
    if (q.h2) out.h2 = { x: round(q.h2.x + dx), y: round(q.h2.y + dy) };
    return out;
  });
}

/** horgony törlése (legalább `min` marad); a szomszéd-fogók változatlanok. */
export function deleteAnchor(points: PathPoint[], index: number, min = 2): PathPoint[] {
  if (index < 0 || index >= points.length || points.length <= min) return points;
  return points.filter((_, i) => i !== index).map(clonePt);
}

/**
 * Egy fogó húzása. `mode` szabja meg, mi történik a szemközti fogóval:
 * `mirrored` = tükrözve (azonos hossz, ellentétes irány); `smooth` = kollineáris
 * marad, de a saját hosszát tartja; `broken`/`corner` = a másik nem mozdul.
 */
export function dragHandle(
  points: PathPoint[],
  index: number,
  handle: HandleId,
  x: number,
  y: number,
  mode: NodeType = 'smooth'
): PathPoint[] {
  if (index < 0 || index >= points.length) return points;
  return points.map((q, i) => {
    if (i !== index) return clonePt(q);
    const out = clonePt(q);
    const anchor = { x: out.x, y: out.y };
    out[handle] = { x: round(x), y: round(y) };
    if (mode === 'broken' || mode === 'corner') return out;
    const other: HandleId = handle === 'h1' ? 'h2' : 'h1';
    const v = sub({ x, y }, anchor);
    if (mode === 'mirrored') {
      out[other] = { x: round(anchor.x - v.x), y: round(anchor.y - v.y) };
    } else {
      // smooth: a másik fogó irányát fordítjuk, de a HOSSZÁT megtartjuk
      const prev = out[other];
      const oppLen = prev ? dist(anchor, prev) : len(v);
      const dir = norm(v);
      out[other] = {
        x: round(anchor.x - dir.x * oppLen),
        y: round(anchor.y - dir.y * oppLen),
      };
    }
    return out;
  });
}

/** egy fogó hossz-megtartó default a szomszédokból (1/6 szabály). */
function defaultLen(anchor: Vec, prev?: PathPoint, next?: PathPoint): number {
  if (prev && next) return (dist(prev, next) / 6) || 0.08;
  if (next) return (dist(anchor, next) / 3) || 0.08;
  if (prev) return (dist(anchor, prev) / 3) || 0.08;
  return 0.08;
}

/**
 * Node-típus váltása. `corner` → fogók törlése (éles sarok). `mirrored`/`smooth`
 * → kollineáris fogók: meglévő fogókból az átlag-tengely, hiányzókból a
 * szomszéd-horgonyok érintője (Catmull-Rom-szerű). `broken` → a fogók
 * függetlenné válnak (ha nincsenek, a szomszédokból származtatunk párat).
 */
export function setNodeType(
  points: PathPoint[],
  index: number,
  type: NodeType,
  closed = false
): PathPoint[] {
  const n = points.length;
  if (index < 0 || index >= n) return points;
  return points.map((q, i) => {
    if (i !== index) return clonePt(q);
    const p = clonePt(q);
    if (type === 'corner') {
      delete p.h1;
      delete p.h2;
      return p;
    }
    const anchor = { x: p.x, y: p.y };
    if (type === 'broken' && (p.h1 || p.h2)) {
      return p; // már vannak fogók, csak a megkötés szűnik meg — hagyjuk őket
    }
    const prev = closed ? points[(index - 1 + n) % n] : points[index - 1];
    const next = closed ? points[(index + 1) % n] : points[index + 1];
    const inV = p.h1 ? sub(p.h1, anchor) : null;
    const outV = p.h2 ? sub(p.h2, anchor) : null;
    // tengely: meglévő fogókból (kimenő + a bejövő megfordítva), különben a
    // szomszéd-horgonyokból
    let axis: Vec;
    if (inV || outV) {
      const outward = outV ? norm(outV) : scaleV(norm(inV!), -1);
      const inwardAsOut = inV ? scaleV(norm(inV), -1) : outward;
      axis = norm(add(outward, inwardAsOut));
    } else if (prev && next) {
      axis = norm(sub(next, prev));
    } else if (next) {
      axis = norm(sub(next, anchor));
    } else if (prev) {
      axis = norm(sub(anchor, prev));
    } else {
      axis = { x: 1, y: 0 };
    }
    if (!Number.isFinite(axis.x) || !Number.isFinite(axis.y) || len(axis) < 1e-9) {
      axis = { x: 1, y: 0 };
    }
    let len1 = inV ? len(inV) : defaultLen(anchor, prev, next);
    let len2 = outV ? len(outV) : defaultLen(anchor, prev, next);
    if (type === 'mirrored') {
      const L = (len1 + len2) / 2 || defaultLen(anchor, prev, next);
      len1 = L;
      len2 = L;
    }
    p.h1 = { x: round(anchor.x - axis.x * len1), y: round(anchor.y - axis.y * len1) };
    p.h2 = { x: round(anchor.x + axis.x * len2), y: round(anchor.y + axis.y * len2) };
    return p;
  });
}

/**
 * Szegmens felosztása `t`-nél új horgonnyal — a görbe ALAKJA NEM változik.
 * Egyenes szakasz → egyszerű felezés; köbös Bézier → de Casteljau-osztás (a
 * két szomszéd fogója és az új horgony fogói pontosan az eredeti görbét adják).
 */
export function splitSegment(
  points: PathPoint[],
  index: number,
  t: number,
  closed = false
): PathPoint[] {
  const n = points.length;
  const maxSeg = closed ? n : n - 1;
  if (index < 0 || index >= maxSeg) return points;
  const a = points[index];
  const bi = (index + 1) % n;
  const b = points[bi];
  const out = points.map(clonePt);
  const tt = Math.min(1, Math.max(0, t));

  if (!a.h2 && !b.h1) {
    const m = lerpP(a, b, tt);
    out.splice(index + 1, 0, rp(m));
    return out;
  }

  const P0 = a;
  const P1 = a.h2 ?? { x: a.x, y: a.y };
  const P2 = b.h1 ?? { x: b.x, y: b.y };
  const P3 = b;
  const Q0 = lerpP(P0, P1, tt);
  const Q1 = lerpP(P1, P2, tt);
  const Q2 = lerpP(P2, P3, tt);
  const R0 = lerpP(Q0, Q1, tt);
  const R1 = lerpP(Q1, Q2, tt);
  const S = lerpP(R0, R1, tt);

  out[index] = { ...out[index], h2: { x: round(Q0.x), y: round(Q0.y) } };
  out[bi] = { ...out[bi], h1: { x: round(Q2.x), y: round(Q2.y) } };
  const mid: PathPoint = {
    x: round(S.x),
    y: round(S.y),
    h1: { x: round(R0.x), y: round(R0.y) },
    h2: { x: round(R1.x), y: round(R1.y) },
  };
  out.splice(index + 1, 0, mid);
  return out;
}

/** új horgony a path-ra a (x,y)-hoz legközelebbi ponton (görbe-tartó). */
export function insertAnchor(
  points: PathPoint[],
  x: number,
  y: number,
  closed = false
): PathPoint[] {
  const hit = nearestOnPath(points, closed, x, y);
  if (!hit) return points;
  return splitSegment(points, hit.seg, hit.t, closed);
}

/** path irányának megfordítása — a sorrend fordul, minden h1↔h2 cserélődik. */
export function reversePath(points: PathPoint[]): PathPoint[] {
  return points
    .slice()
    .reverse()
    .map((p) => {
      const q: PathPoint = { x: p.x, y: p.y };
      if (p.h2) q.h1 = { x: p.h2.x, y: p.h2.y };
      if (p.h1) q.h2 = { x: p.h1.x, y: p.h1.y };
      return q;
    });
}

/**
 * Két nyitott path összefűzése (a→b sorrendben). `weldTol > 0` és az `a` vége
 * egybeesik `b` elejével → a két végpont eggyé olvad (az `a` végpontja marad,
 * a kimenő fogót `b` elejéről kapja).
 */
export function joinPaths(a: PathPoint[], b: PathPoint[], weldTol = 0): PathPoint[] {
  if (!a.length) return b.map(clonePt);
  if (!b.length) return a.map(clonePt);
  const A = a.map(clonePt);
  const B = b.map(clonePt);
  const last = A[A.length - 1];
  const first = B[0];
  if (weldTol > 0 && dist(last, first) <= weldTol) {
    if (first.h2) last.h2 = { x: first.h2.x, y: first.h2.y };
    else delete last.h2;
    return [...A, ...B.slice(1)];
  }
  return [...A, ...B];
}
