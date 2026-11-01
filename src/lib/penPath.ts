import { normalizeSubpaths } from '@/lib/vectorPath';
import type { PathPoint, ShapeLayer } from '@/types/project';

/** egy vászon-térbeli (0–1) pont a tollhoz */
export interface CanvasPoint {
  x: number;
  y: number;
  /** bejövő és kimenő fogantyú (görbe csomópont), vászon-térben */
  h1?: { x: number; y: number };
  h2?: { x: number; y: number };
}

/** ennyi pont húzás alatt koppintásnak számít: sarokpont lesz */
export const PEN_DRAG_MIN_PX = 6;

/**
 * Húzásból görbe csomópont: a kimenő fogantyú a húzás vége, a bejövő a tükörképe. Kis mozdulatnál
 * sarokpont marad, így a remegő ujj nem ad véletlen görbét.
 */
export function anchorFromDrag(anchor: { x: number; y: number }, drag: { x: number; y: number }, box: { w: number; h: number }): CanvasPoint {
  const px = Math.hypot((drag.x - anchor.x) * box.w, (drag.y - anchor.y) * box.h);
  if (px < PEN_DRAG_MIN_PX) {
    return { x: anchor.x, y: anchor.y };
  }
  return { x: anchor.x, y: anchor.y, h2: { x: drag.x, y: drag.y }, h1: { x: 2 * anchor.x - drag.x, y: 2 * anchor.y - drag.y } };
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
    { points: points.map((p) => ({ ...p })) as PathPoint[], closed },
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
