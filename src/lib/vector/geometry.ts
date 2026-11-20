import type { PathPoint } from '@/types/project';

// ✒️ Vektor-toll — közös típusok és vektor-segédek (a `vectorPath` belső magja).

export type NodeType = 'corner' | 'smooth' | 'mirrored' | 'broken';
export type HandleId = 'h1' | 'h2';

/** egy önálló al-path (a `subpaths` egy eleme, ill. a `points` + `closed`) */
export interface Subpath {
  points: PathPoint[];
  closed: boolean;
}

export const round = (v: number) => Math.round(v * 1e4) / 1e4;

export interface Vec {
  x: number;
  y: number;
}

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scaleV = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a) || 1e-9;
  return { x: a.x / l, y: a.y / l };
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpP = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** horgonypont másolat (nem szór be `undefined` kulcsokat) */
export function clonePt(p: PathPoint): PathPoint {
  const q: PathPoint = { x: p.x, y: p.y };
  if (p.h1) q.h1 = { x: p.h1.x, y: p.h1.y };
  if (p.h2) q.h2 = { x: p.h2.x, y: p.h2.y };
  return q;
}

/** horgonypont kerekítve (x/y + a meglévő fogók) */
export function rp(p: PathPoint): PathPoint {
  const q: PathPoint = { x: round(p.x), y: round(p.y) };
  if (p.h1) q.h1 = { x: round(p.h1.x), y: round(p.h1.y) };
  if (p.h2) q.h2 = { x: round(p.h2.x), y: round(p.h2.y) };
  return q;
}

export const cubic = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
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
