import type { Subpath } from '@/lib/vectorPath';
import { apply, IDENTITY, type Mat } from './matrix';
import { round } from './style';

// ── Geometria-segédek ──────────────────────────────────────────────────────

export function rectPath(x: number, y: number, w: number, h: number): Subpath {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    closed: true,
  };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  // 4 köbös ív (a szokásos 0.5523 kappa-fogóaránnyal)
  const k = 0.5522847498;
  const pts = [
    { x: cx + rx, y: cy },
    { x: cx, y: cy + ry },
    { x: cx - rx, y: cy },
    { x: cx, y: cy - ry },
  ];
  const points = [
    { x: pts[0].x, y: pts[0].y, h1: { x: cx + rx, y: cy - ry * k }, h2: { x: cx + rx, y: cy + ry * k } },
    { x: pts[1].x, y: pts[1].y, h1: { x: cx + rx * k, y: cy + ry }, h2: { x: cx - rx * k, y: cy + ry } },
    { x: pts[2].x, y: pts[2].y, h1: { x: cx - rx, y: cy + ry * k }, h2: { x: cx - rx, y: cy - ry * k } },
    { x: pts[3].x, y: pts[3].y, h1: { x: cx - rx * k, y: cy - ry }, h2: { x: cx + rx * k, y: cy - ry } },
  ];
  return { points, closed: true };
}

export function bakeMatrix(subpaths: Subpath[], m: Mat): Subpath[] {
  if (m === IDENTITY) return subpaths;
  return subpaths.map((s) => ({
    closed: s.closed,
    points: s.points.map((p) => {
      const a = apply(m, p.x, p.y);
      const q: { x: number; y: number; h1?: { x: number; y: number }; h2?: { x: number; y: number } } = {
        x: a.x,
        y: a.y,
      };
      if (p.h1) q.h1 = apply(m, p.h1.x, p.h1.y);
      if (p.h2) q.h2 = apply(m, p.h2.x, p.h2.y);
      return q;
    }),
  }));
}

interface Box {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/** al-path-ok HORGONY-dobozа (fogók nélkül) — a primitívek pontosan kitöltik. */
export function anchorBounds(subpaths: Subpath[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of subpaths)
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, w: Math.max(1e-4, maxX - minX), h: Math.max(1e-4, maxY - minY) };
}

/** user-térbeli doboz → doksi-normalizált középpont + méret (0–1). */
export function boxToDoc(
  b: Box,
  vb: { x: number; y: number; w: number; h: number }
): { center: { x: number; y: number }; w: number; h: number } {
  return {
    center: { x: round((b.minX + b.w / 2 - vb.x) / vb.w), y: round((b.minY + b.h / 2 - vb.y) / vb.h) },
    w: round(b.w / vb.w),
    h: round(b.h / vb.h),
  };
}
