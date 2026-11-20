import type { PathPoint } from '@/types/project';
import { rp, type Subpath, type Vec } from './geometry';

// ✒️ Al-path befoglaló doboz + 0…1-re normalizálás (SVG import → klip).

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
