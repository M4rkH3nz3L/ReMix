/**
 * 🧲 Smart-guides (IMGEDD §8) — pure, tesztelhető igazodás-mag. Húzáskor a MOZGATOTT
 * réteg középvonala/élei a TÖBBI réteg középvonalához/éleihez + a vászon közepéhez/széleihez
 * pattannak (normalizált 0–1 térben). Csak a számítás él itt; a gesztus a komponensé.
 *
 * A dobozok KÖZÉP-pozícióval (x,y) + teljes mérettel (w,h) adottak. Ami méret nélküli
 * (pl. szöveg), annak w=h=0 → csak a KÖZEPE pattan.
 */
export interface LayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapLine {
  axis: 'x' | 'y';
  /** a guide-vonal normalizált pozíciója (0–1) azon a tengelyen */
  at: number;
}

export interface SnapResult {
  x: number;
  y: number;
  lines: SnapLine[];
}

const EPS = 1e-6;

/** egy tengely snap-ja: a mozgatott 3 éle (közép/kezdet/vég) a legközelebbi célhoz a küszöbön belül */
function snapAxis(center: number, half: number, targets: number[], threshold: number): { delta: number; at: number } | null {
  const edges = [center, center - half, center + half];
  let best: { delta: number; at: number } | null = null;
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= threshold + EPS && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, at: t };
      }
    }
  }
  return best;
}

/**
 * A mozgatott doboz KÖZÉP-pozíciójának igazítása a többi dobozhoz + a vászonhoz.
 * Visszaadja a (pattintott) közép-pozíciót és az aktív guide-vonalakat (megjelenítéshez).
 */
export function snapToLayers(dragged: LayerBox, others: LayerBox[], threshold = 0.012): SnapResult {
  const targetsX = [0, 0.5, 1];
  const targetsY = [0, 0.5, 1];
  for (const o of others) {
    targetsX.push(o.x, o.x - o.w / 2, o.x + o.w / 2);
    targetsY.push(o.y, o.y - o.h / 2, o.y + o.h / 2);
  }
  const sx = snapAxis(dragged.x, dragged.w / 2, targetsX, threshold);
  const sy = snapAxis(dragged.y, dragged.h / 2, targetsY, threshold);
  const lines: SnapLine[] = [];
  let x = dragged.x;
  let y = dragged.y;
  if (sx) {
    x = dragged.x + sx.delta;
    lines.push({ axis: 'x', at: sx.at });
  }
  if (sy) {
    y = dragged.y + sy.delta;
    lines.push({ axis: 'y', at: sy.at });
  }
  return { x, y, lines };
}
