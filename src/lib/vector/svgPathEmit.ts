import type { PathPoint } from '@/types/project';
import type { Subpath, Vec } from './geometry';

// ✒️ SVG path `d` kiírás (al-path → `d`).

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
