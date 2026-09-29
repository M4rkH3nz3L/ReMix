import type { PathPoint } from '@/types/project';

/**
 * ✒️ Vektor-toll mag (Creative Canvas) — pure Bézier-node szerkesztés a
 * `ShapeClip.points` / `subpaths` (`PathPoint[]`) fölött. A `maskEdit.ts` csak
 * fogó nélküli poligon-maszkokat kezel; ez a köbös Bézier-toll matematikája:
 * horgony/fog­ó hozzáadás-mozgatás-törlés, node-típus váltás (corner/smooth/
 * mirrored/broken), szegmens-osztás (de Casteljau) és SVG path `d` oda-vissza.
 *
 * Koordináta-rend: minden `x`/`y` 0…1 a klip SAJÁT dobozában. A `h1` a BEJÖVŐ,
 * a `h2` a KIMENŐ fogó ABSZOLÚT (nem relatív) pozíciója — pontosan úgy, ahogy a
 * `draw.ts:pathData` és a `boolean.ts:flattenShape` várja. A fogók SZÁNDÉKOSAN
 * nincsenek 0–1-re vágva: egy Bézier-vezérlőpont rendszeresen kilóg a dobozból,
 * a levágás eltorzítaná a görbét.
 *
 * Minden művelet ÚJ tömböt ad vissza (a hívó a command-buson teszi be → undo).
 */

export type NodeType = 'corner' | 'smooth' | 'mirrored' | 'broken';
export type HandleId = 'h1' | 'h2';

/** egy önálló al-path (a `subpaths` egy eleme, ill. a `points` + `closed`) */
export interface Subpath {
  points: PathPoint[];
  closed: boolean;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
/** két fogó kollinearitásának küszöbe (keresztszorzat / hosszak) */
const COLIN_EPS = 1e-3;

interface Vec {
  x: number;
  y: number;
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scaleV = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (a: Vec): Vec => {
  const l = len(a) || 1e-9;
  return { x: a.x / l, y: a.y / l };
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** horgonypont másolat (nem szór be `undefined` kulcsokat) */
function clonePt(p: PathPoint): PathPoint {
  const q: PathPoint = { x: p.x, y: p.y };
  if (p.h1) q.h1 = { x: p.h1.x, y: p.h1.y };
  if (p.h2) q.h2 = { x: p.h2.x, y: p.h2.y };
  return q;
}

/** horgonypont kerekítve (x/y + a meglévő fogók) */
function rp(p: PathPoint): PathPoint {
  const q: PathPoint = { x: round(p.x), y: round(p.y) };
  if (p.h1) q.h1 = { x: round(p.h1.x), y: round(p.h1.y) };
  if (p.h2) q.h2 = { x: round(p.h2.x), y: round(p.h2.y) };
  return q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiértékelés / lekérdezés
// ─────────────────────────────────────────────────────────────────────────────

const cubic = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
};

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

// ─────────────────────────────────────────────────────────────────────────────
// SVG path `d` — parse ↔ emit (import/export a `points`/`subpaths`-hoz)
// ─────────────────────────────────────────────────────────────────────────────

interface Token {
  cmd?: string;
  num?: number;
}

function tokenizeSvg(d: string): Token[] {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] });
    else out.push({ num: parseFloat(m[2]) });
  }
  return out;
}

/**
 * Elliptikus ív → köbös Bézier-szegmensek (a→b), a W3C endpoint→center
 * konverzióval, ≤90°-os darabokban. A darabszámhoz a `4/3·tan(Δ/4)` fogó-arány.
 * FIGYELEM: a `d`-ben a nagyív/söprés-flageknek külön számnak kell lenniük
 * (`... 0 1 ...`), az egybeírt flag-forma (`...01...`) NEM támogatott.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): { c1: Vec; c2: Vec; end: Vec }[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x: x2, y: y2 } }];
  }
  const rad = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rxs = rx * rx;
  let rys = ry * ry;
  const x1ps = x1p * x1p;
  const y1ps = y1p * y1p;
  const lambda = x1ps / rxs + y1ps / rys;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rxs = rx * rx;
    rys = ry * ry;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = Math.max(0, rxs * rys - rxs * y1ps - rys * x1ps);
  const denom = rxs * y1ps + rys * x1ps || 1e-12;
  const coef = sign * Math.sqrt(num / denom);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (-coef * (ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const l = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1e-12;
    let a = Math.acos(Math.min(1, Math.max(-1, dot / l)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segs;
  const tcp = (4 / 3) * Math.tan(delta / 4);
  const point = (ang: number): Vec => ({
    x: cos * rx * Math.cos(ang) - sin * ry * Math.sin(ang) + cx,
    y: sin * rx * Math.cos(ang) + cos * ry * Math.sin(ang) + cy,
  });
  const deriv = (ang: number): Vec => {
    const d1x = -rx * Math.sin(ang);
    const d1y = ry * Math.cos(ang);
    return { x: cos * d1x - sin * d1y, y: sin * d1x + cos * d1y };
  };
  const out: { c1: Vec; c2: Vec; end: Vec }[] = [];
  let t1 = theta1;
  for (let i = 0; i < segs; i++) {
    const t2 = t1 + delta;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = deriv(t1);
    const d2 = deriv(t2);
    out.push({
      c1: { x: p1.x + tcp * d1.x, y: p1.y + tcp * d1.y },
      c2: { x: p2.x - tcp * d2.x, y: p2.y - tcp * d2.y },
      end: p2,
    });
    t1 = t2;
  }
  return out;
}

/**
 * SVG path `d` → al-path-ok. Támogatott: M/L/H/V/C/S/Q/T/A/Z (abszolút és
 * relatív), implicit parancs-ismétlés, Q/T→köbös konverzió, S/T reflexió, ív→
 * Bézier. Minden `M` új al-path. A koordináták a `d` SAJÁT egységrendszerében
 * jönnek — a dobozba illesztéshez lásd `normalizeSubpaths`.
 */
export function parseSvgPath(d: string): Subpath[] {
  const toks = tokenizeSvg(d);
  const subs: Subpath[] = [];
  let sp: Subpath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicC2: Vec | null = null; // az utolsó C/S második vezérlője (S-reflexió)
  let lastQuad: Vec | null = null; // az utolsó Q/T vezérlője (T-reflexió)
  let prev = '';
  let ci = 0;
  let cmd = '';

  const rd = () => toks[ci++].num as number;
  const peekNum = () => ci < toks.length && toks[ci].num !== undefined;
  const readPt = (rel: boolean): Vec => {
    const ax = rd();
    const ay = rd();
    return rel ? { x: cx + ax, y: cy + ay } : { x: ax, y: ay };
  };
  const flush = () => {
    if (sp && sp.points.length) subs.push(sp);
  };
  const startSub = (x: number, y: number) => {
    flush();
    sp = { points: [{ x, y }], closed: false };
    sx = x;
    sy = y;
    cx = x;
    cy = y;
  };
  const lineTo = (x: number, y: number) => {
    sp!.points.push({ x, y });
    cx = x;
    cy = y;
  };
  const curveTo = (c1: Vec, c2: Vec, x: number, y: number) => {
    const last = sp!.points[sp!.points.length - 1];
    last.h2 = { x: c1.x, y: c1.y };
    sp!.points.push({ x, y, h1: { x: c2.x, y: c2.y } });
    cx = x;
    cy = y;
    lastCubicC2 = { x: c2.x, y: c2.y };
    lastQuad = null;
  };
  const quadTo = (qx: number, qy: number, x: number, y: number) => {
    const c1 = { x: cx + (2 / 3) * (qx - cx), y: cy + (2 / 3) * (qy - cy) };
    const c2 = { x: x + (2 / 3) * (qx - x), y: y + (2 / 3) * (qy - y) };
    curveTo(c1, c2, x, y);
    lastQuad = { x: qx, y: qy };
  };
  const reflect = (ctrl: Vec | null): Vec =>
    ctrl ? { x: 2 * cx - ctrl.x, y: 2 * cy - ctrl.y } : { x: cx, y: cy };

  while (ci < toks.length) {
    if (toks[ci].cmd !== undefined) {
      cmd = toks[ci].cmd as string;
      ci++;
      if (cmd === 'Z' || cmd === 'z') {
        if (sp) {
          sp.closed = true;
          flush();
          sp = null;
          cx = sx;
          cy = sy;
        }
        prev = 'Z';
        continue;
      }
    }
    if (cmd === '') {
      ci++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    // Z után parancs `M` nélkül → új al-path az aktuális pontból
    if (sp === null && C !== 'M') {
      sp = { points: [{ x: cx, y: cy }], closed: false };
      sx = cx;
      sy = cy;
    }
    switch (C) {
      case 'M': {
        const p = readPt(rel);
        startSub(p.x, p.y);
        while (peekNum()) {
          const l = readPt(rel);
          lineTo(l.x, l.y);
        }
        break;
      }
      case 'L': {
        do {
          const l = readPt(rel);
          lineTo(l.x, l.y);
        } while (peekNum());
        break;
      }
      case 'H': {
        do {
          const x = rd() + (rel ? cx : 0);
          lineTo(x, cy);
        } while (peekNum());
        break;
      }
      case 'V': {
        do {
          const y = rd() + (rel ? cy : 0);
          lineTo(cx, y);
        } while (peekNum());
        break;
      }
      case 'C': {
        do {
          const c1 = readPt(rel);
          const c2 = readPt(rel);
          const e = readPt(rel);
          curveTo(c1, c2, e.x, e.y);
        } while (peekNum());
        break;
      }
      case 'S': {
        do {
          const c1 = prev === 'C' || prev === 'S' ? reflect(lastCubicC2) : { x: cx, y: cy };
          const c2 = readPt(rel);
          const e = readPt(rel);
          curveTo(c1, c2, e.x, e.y);
          prev = 'S';
        } while (peekNum());
        break;
      }
      case 'Q': {
        do {
          const q = readPt(rel);
          const e = readPt(rel);
          quadTo(q.x, q.y, e.x, e.y);
        } while (peekNum());
        break;
      }
      case 'T': {
        do {
          const q = prev === 'Q' || prev === 'T' ? reflect(lastQuad) : { x: cx, y: cy };
          const e = readPt(rel);
          quadTo(q.x, q.y, e.x, e.y);
          prev = 'T';
        } while (peekNum());
        break;
      }
      case 'A': {
        do {
          const rx = rd();
          const ry = rd();
          const phi = rd();
          const laf = rd();
          const sf = rd();
          const e = readPt(rel);
          const cubics = arcToCubics(cx, cy, rx, ry, phi, laf, sf, e.x, e.y);
          for (const seg of cubics) curveTo(seg.c1, seg.c2, seg.end.x, seg.end.y);
        } while (peekNum());
        break;
      }
      default:
        ci++;
        break;
    }
    prev = C;
  }
  flush();
  return subs
    .filter((s) => s.points.length >= 1)
    .map((s) => ({ points: s.points.map(rp), closed: s.closed }));
}

const fmt = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/** al-path → SVG path `d` (a `draw.ts:pathData` konvenciójával: C/L/Z). */
export function pointsToSvgPath(points: PathPoint[], closed = false): string {
  if (!points.length) return '';
  const P = (p: Vec) => `${fmt(p.x)} ${fmt(p.y)}`;
  const n = points.length;
  let d = `M${P(points[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.h2 || b.h1) d += ` C${P(a.h2 ?? a)} ${P(b.h1 ?? b)} ${P(b)}`;
    else d += ` L${P(b)}`;
  }
  if (closed) d += ' Z';
  return d;
}

/** több al-path → egyetlen `d` (összefűzve). */
export function subpathsToSvgPath(subpaths: Subpath[]): string {
  return subpaths
    .map((s) => pointsToSvgPath(s.points, s.closed))
    .filter(Boolean)
    .join(' ');
}

/** minden al-path horgonyainak ÉS fogóinak befoglaló doboza. */
export function subpathsBounds(
  subpaths: Subpath[]
): { minX: number; minY: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (p?: Vec) => {
    if (!p) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const s of subpaths) {
    for (const p of s.points) {
      eat(p);
      eat(p.h1);
      eat(p.h2);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
}

/**
 * Al-path-ok 0…1-be illesztése a közös befoglaló dobozba (SVG import → klip):
 * a `box` a forrás-koordinátákbeli doboz (a hívó ebből számol pozíciót/méretet),
 * a visszaadott al-path-ok a dobozra 0–1-re normalizáltak.
 */
export function normalizeSubpaths(subpaths: Subpath[]): {
  subpaths: Subpath[];
  box: { minX: number; minY: number; w: number; h: number };
} {
  const box = subpathsBounds(subpaths) ?? { minX: 0, minY: 0, w: 1, h: 1 };
  const map = (p: Vec): Vec => ({ x: (p.x - box.minX) / box.w, y: (p.y - box.minY) / box.h });
  const mapped = subpaths.map((s) => ({
    closed: s.closed,
    points: s.points.map((p) => {
      const q: PathPoint = rp(map(p));
      if (p.h1) q.h1 = rp(map(p.h1)) as Vec;
      if (p.h2) q.h2 = rp(map(p.h2)) as Vec;
      return q;
    }),
  }));
  return { subpaths: mapped, box };
}
