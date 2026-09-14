import type { PathPoint, ShapeClip } from '@/types/project';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

interface Pt {
  x: number;
  y: number;
}

/** nyíl/csillag egység-poligonjai (0–100), a renderrel/előnézettel közösek */
const POLY = {
  arrow: [[0, 35], [60, 35], [60, 12], [100, 50], [60, 88], [60, 65], [0, 65]],
  star: [
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70],
    [21, 91], [32, 57], [2, 35], [39, 35],
  ],
} as const;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Egy forma VÁSZON-térbeli poligonja (0…1 vászon-koordináták). */
export function flattenShape(clip: ShapeClip): Pt[] {
  const cx = clip.position.x;
  const cy = clip.position.y;
  const map = (lx: number, ly: number): Pt => ({
    x: cx - clip.w / 2 + lx * clip.w,
    y: cy - clip.h / 2 + ly * clip.h,
  });
  if (clip.shape === 'ellipse') {
    const out: Pt[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      out.push(map(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)));
    }
    return out;
  }
  if (clip.shape === 'arrow' || clip.shape === 'star') {
    return POLY[clip.shape].map(([px, py]) => map(px / 100, py / 100));
  }
  if (clip.shape === 'path' && Array.isArray(clip.points) && clip.points.length >= 2) {
    // a Bézier-szegmenseket sűrű polyline-ra bontjuk
    const pts = clip.points;
    const n = pts.length;
    const out: Pt[] = [];
    const segs = clip.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a.h2 || b.h1) {
        for (let s = 0; s < 10; s++) {
          out.push(cubic(a, a.h2 ?? a, b.h1 ?? b, b, s / 10));
        }
      } else {
        out.push({ x: a.x, y: a.y });
      }
    }
    if (!clip.closed) {
      out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    }
    return out.map((p) => map(p.x, p.y));
  }
  // rectangle (és minden más) — a doboz négy sarka
  return [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
}

function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function ensureWinding(poly: Pt[], positive: boolean): Pt[] {
  const a = signedArea(poly);
  return a >= 0 === positive ? poly : [...poly].reverse();
}

/** Sutherland–Hodgman: `subject` levágása a (konvex) `clip` poligonra. */
function clipSH(subject: Pt[], clip: Pt[]): Pt[] {
  const cl = ensureWinding(clip, true); // pozitív (CCW a jelölt-térben)
  let output = subject;
  for (let i = 0; i < cl.length; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % cl.length];
    const inside = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    const inter = (p: Pt, q: Pt): Pt => {
      const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
      const t = d1 / (d1 - d2);
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = inside(p);
      const qin = inside(q);
      if (qin) {
        if (!pin) output.push(inter(p, q));
        output.push(q);
      } else if (pin) {
        output.push(inter(p, q));
      }
    }
    if (output.length === 0) break;
  }
  return output;
}

const toPathPoints = (poly: Pt[]): PathPoint[] => poly.map((p) => ({ x: p.x, y: p.y }));

/**
 * 🔗 Két forma boolean-kombinációja → összetett path adat (VÁSZON-térben, azaz a
 * result shape w=h=1, position középen). Union/exclude a fill-rule-lal pontos;
 * a subtract lyuk-technika (a `b`-t kivonja `a`-ból); az intersect Sutherland–
 * Hodgman (a `b` mint konvex vágó). @returns null, ha nincs értelmes eredmény.
 */
export function booleanShapes(
  a: ShapeClip,
  b: ShapeClip,
  op: BooleanOp
): { subpaths: PathPoint[][]; fillRule: 'nonzero' | 'evenodd' } | null {
  const pa = flattenShape(a);
  const pb = flattenShape(b);
  if (pa.length < 3 || pb.length < 3) {
    return null;
  }
  if (op === 'intersect') {
    const clipped = clipSH(ensureWinding(pa, true), pb);
    if (clipped.length < 3) {
      return null;
    }
    return { subpaths: [toPathPoints(clipped)], fillRule: 'nonzero' };
  }
  if (op === 'exclude') {
    return { subpaths: [toPathPoints(pa), toPathPoints(pb)], fillRule: 'evenodd' };
  }
  if (op === 'subtract') {
    // a lyuk az A∩B (mindig `a`-n BELÜL) fordított irányítással → a nonzero
    // csak `a`-ból vágja ki; `b`-nek az `a`-n kívüli része nem jelenik meg
    const hole = clipSH(ensureWinding(pa, true), pb);
    const aPos = toPathPoints(ensureWinding(pa, true));
    if (hole.length < 3) {
      return { subpaths: [aPos], fillRule: 'nonzero' };
    }
    return {
      subpaths: [aPos, toPathPoints(ensureWinding(hole, false))],
      fillRule: 'nonzero',
    };
  }
  // union: mindkettő azonos irányítás, nonzero
  return {
    subpaths: [toPathPoints(ensureWinding(pa, true)), toPathPoints(ensureWinding(pb, true))],
    fillRule: 'nonzero',
  };
}
