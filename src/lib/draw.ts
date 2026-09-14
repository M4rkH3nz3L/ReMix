/**
 * ✏️ Rajzolás / ecset — pure réteg.
 *
 * Az ujjal húzott vonal nyers pontsora sűrű és zajos (60+ pont/másodperc),
 * ezért mentés előtt EGYSZERŰSÍTJÜK (Ramer–Douglas–Peucker): a projekt-JSON
 * kicsi marad, a render SVG-je gyors, a vonal alakja mégis megmarad.
 *
 * A kész vonal a meglévő FORMA-rétegre fordul (`shape: 'path'`), így a
 * húzás/méretezés, a követés, a stílus-másolás, a maszkolás és a render-út
 * mind ingyen működik rajta.
 */

import type { PathPoint } from '@/types/project';

export interface Point {
  x: number;
  y: number;
}

/** pont–szakasz távolság négyzete (a gyökvonás fölösleges az összevetéshez) */
function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/**
 * Ramer–Douglas–Peucker: a `tolerance`-nál közelebb eső pontok elhagyhatók.
 * A két végpont mindig megmarad. Iteratív (nem rekurzív), hogy egy hosszú
 * vonal se boríthassa a hívási vermet.
 */
export function simplifyPath(points: Point[], tolerance = 0.004): Point[] {
  if (points.length <= 2) {
    return [...points];
  }
  const tolSq = tolerance * tolerance;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distToSegmentSq(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index >= 0 && maxDist > tolSq) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface DrawBounds {
  /** középpont, vászon-normalizálva */
  x: number;
  y: number;
  /** méret a vászon arányában */
  w: number;
  h: number;
}

/**
 * A vonal befoglaló doboza + margó a vonalvastagságnak (különben a render a
 * vonal felét levágná a doboz szélén).
 *
 * A `strokeWidth` a vászon MAGASSÁGÁNAK %-a, a doboz szélessége viszont a
 * vászon SZÉLESSÉGÉHEZ normalizált — ezért kell az `aspect` (w/h) a vízszintes
 * margó átváltásához, különben keskeny vásznon az oldalsó margó túl nagy lenne.
 */
export function pathBounds(
  points: Point[],
  strokeWidth: number,
  aspect = 0.5625
): DrawBounds | null {
  if (points.length === 0) {
    return null;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const padY = strokeWidth / 100;
  const padX = padY / Math.max(0.05, aspect);
  const x1 = Math.min(...xs) - padX;
  const x2 = Math.max(...xs) + padX;
  const y1 = Math.min(...ys) - padY;
  const y2 = Math.max(...ys) + padY;
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    // a doboz sosem lehet nulla széles (egyenes vonalnál az lenne)
    w: Math.max(0.01, x2 - x1),
    h: Math.max(0.01, y2 - y1),
  };
}

/** a vászon-pontok átszámítása a doboz saját 0–1 terébe (a render ezt várja) */
export function toBoxSpace(points: Point[], bounds: DrawBounds): Point[] {
  const x1 = bounds.x - bounds.w / 2;
  const y1 = bounds.y - bounds.h / 2;
  return points.map((p) => ({
    x: Math.round(((p.x - x1) / bounds.w) * 1000) / 1000,
    y: Math.round(((p.y - y1) / bounds.h) * 1000) / 1000,
  }));
}

/** ecset-stílusok: szín-alapérték, vastagság, átlátszóság, ragyogás */
export const BRUSH_STYLES = [
  { id: 'marker', label: 'lib.draw.brush.marker', width: 0.9, opacity: 1, glow: false },
  { id: 'highlighter', label: 'lib.draw.brush.highlighter', width: 2.6, opacity: 0.42, glow: false },
  { id: 'neon', label: 'lib.draw.brush.neon', width: 0.8, opacity: 1, glow: true },
] as const;

export type BrushStyle = (typeof BRUSH_STYLES)[number]['id'];

export const BRUSH_COLORS = [
  '#ff2d95',
  '#00e5ff',
  '#ffd166',
  '#8ef6c4',
  '#ffffff',
  '#0b0b18',
];

/**
 * Az `points` SVG `polyline` pont-sztringgé alakítása a megadott pixelméretre.
 * Közös a renderrel és az előnézettel — hogy a kettő pontosan ugyanazt rajzolja.
 */
export function polylinePoints(points: Point[], w: number, h: number): string {
  return points.map((p) => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`).join(' ');
}

/**
 * ✏️ SVG path `d` a horgonypontokból (Bézier-tudatos): a fogóval (`h1`/`h2`)
 * rendelkező szegmensek köbös görbék (C), a többi egyenes (L). `closed` → Z.
 * KÖZÖS a renderrel és az előnézettel (a text-render.js tükrözi).
 */
export function pathData(
  points: PathPoint[],
  w: number,
  h: number,
  closed = false
): string {
  if (points.length === 0) {
    return '';
  }
  const P = (p: { x: number; y: number }) => `${(p.x * w).toFixed(2)},${(p.y * h).toFixed(2)}`;
  const n = points.length;
  let d = `M${P(points[0])}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.h2 || b.h1) {
      d += `C${P(a.h2 ?? a)} ${P(b.h1 ?? b)} ${P(b)}`;
    } else {
      d += `L${P(b)}`;
    }
  }
  if (closed) {
    d += 'Z';
  }
  return d;
}

/**
 * Polyline-pontok → sima Bézier: minden horgonyhoz a szomszédokból Catmull-Rom
 * érintőt számol, abból be/kimenő fogót. `corner` (fogó nélkül) → éles sarok.
 */
export function smoothToBezier(points: Point[], closed = false, k = 1 / 6): PathPoint[] {
  const n = points.length;
  if (n < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  return points.map((p, i) => {
    const prev = closed ? points[(i - 1 + n) % n] : points[i - 1] ?? p;
    const next = closed ? points[(i + 1) % n] : points[i + 1] ?? p;
    const tx = (next.x - prev.x) * k;
    const ty = (next.y - prev.y) * k;
    return {
      x: p.x,
      y: p.y,
      h1: { x: p.x - tx, y: p.y - ty },
      h2: { x: p.x + tx, y: p.y + ty },
    };
  });
}
