import type { PathPoint } from '@/types/project';

// ✒️ Összetett útvonal: egy gyűrű kiemelése / visszaírása a csomópont-szerkesztőhöz.

/**
 * Összetett útvonal szerkesztése: a szerkesztő mindig egy gyűrűt lát `points`-ként, így ugyanaz a
 * csomópont-szerkesztő működik egyszerű és összetett formán is.
 */
export function pathEditView<L extends { points?: PathPoint[]; subpaths?: PathPoint[][]; closed?: boolean }>(layer: L, ring: number): L {
  if (!layer.subpaths?.length) {
    return layer;
  }
  return { ...layer, points: layer.subpaths[Math.min(ring, layer.subpaths.length - 1)], closed: true };
}

/** A szerkesztett pontok visszaírása a helyes gyűrűbe. */
export function pathEditPatch(layer: { points?: PathPoint[]; subpaths?: PathPoint[][] }, ring: number, points: PathPoint[]): { points: PathPoint[] } | { subpaths: PathPoint[][] } {
  if (!layer.subpaths?.length) {
    return { points };
  }
  const at = Math.min(ring, layer.subpaths.length - 1);
  return { subpaths: layer.subpaths.map((r, i) => (i === at ? points : r)) };
}
