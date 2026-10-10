import { normalizeSubpaths } from '@/lib/vectorPath';
import type { PathPoint, ShapeLayer } from '@/types/project';

/** egy vászon-térbeli (0–1) pont a tollhoz */
export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * ✏️ A toll-eszközzel VÁSZON-térben (0–1) lerakott pontokból path-FORMA réteg.
 * A `normalizeSubpaths` maggal a pontokat a befoglaló dobozukra 0–1-re normalizáljuk
 * (a `ShapeOverlay`/render a klip SAJÁT dobozában rajzol), a doboz közepe lesz a
 * `position`, a doboz mérete a `w`/`h`. Nyitott path → `strokeWidth` vonal (fill-szín);
 * zárt path → kitöltött forma. `null`, ha < 2 pont (nincs értelmes szakasz).
 */
export function pathShapeFromCanvasPoints(
  points: CanvasPoint[],
  closed: boolean,
  id: string,
  fill = '#ff2d95'
): ShapeLayer | null {
  if (points.length < 2) {
    return null;
  }
  const { subpaths, box } = normalizeSubpaths([
    { points: points.map((p) => ({ x: p.x, y: p.y })) as PathPoint[], closed },
  ]);
  const sp = subpaths[0];
  // a degenerált (tökéletesen vízszintes/függőleges) doboz se tűnjön el
  const w = Math.max(0.02, box.w);
  const h = Math.max(0.02, box.h);
  const base: ShapeLayer = {
    kind: 'shape',
    id,
    shape: 'path',
    points: sp.points,
    closed,
    position: { x: box.minX + box.w / 2, y: box.minY + box.h / 2 },
    w,
    h,
    fill,
  };
  // nyitott path → látható vonalvastagság (különben a render nem rajzol stroke-ot)
  return closed ? base : { ...base, strokeWidth: 0.9 };
}
