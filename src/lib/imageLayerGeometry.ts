import type { PathPoint, PhotoLayer, ShapeLayer } from '@/types/project';

/**
 * 📐 Vászon-koordináta → a réteg SAJÁT dobozának terébe (box-lokális 0–1). A réteg
 * forgatása/tükrözése pixel-térben értendő, ezért kell a vászonméret. A worker
 * `maskToBox`-ának tükre: a heal és a lokális korrekció a réteg saját terében fut.
 */
export function canvasToLayerBox(
  point: { x: number; y: number },
  layer: Pick<PhotoLayer, 'position' | 'w' | 'h' | 'rotation' | 'flipH' | 'flipV'>,
  canvas: { width: number; height: number }
): { x: number; y: number } {
  const bw = Math.max(layer.w ?? 1, 0.0001);
  const bh = Math.max(layer.h ?? 1, 0.0001);
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180;
  const dx = (point.x - layer.position.x) * canvas.width;
  const dy = (point.y - layer.position.y) * canvas.height;
  let lx = dx * Math.cos(rad) + dy * Math.sin(rad);
  let ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
  if (layer.flipH) lx = -lx;
  if (layer.flipV) ly = -ly;
  return { x: 0.5 + lx / (bw * canvas.width), y: 0.5 + ly / (bh * canvas.height) };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Lasszó-pontok → a réteg dobozán belüli heal-téglalap (mindig 0–1 között marad). */
export function healRegionFromPoints(
  points: { x: number; y: number }[],
  layer: Pick<PhotoLayer, 'position' | 'w' | 'h' | 'rotation' | 'flipH' | 'flipV'>,
  canvas: { width: number; height: number }
): { x: number; y: number; w: number; h: number } {
  const box = points.map((p) => canvasToLayerBox(p, layer, canvas));
  const x0 = clamp01(Math.min(...box.map((p) => p.x)));
  const y0 = clamp01(Math.min(...box.map((p) => p.y)));
  const x1 = clamp01(Math.max(...box.map((p) => p.x)));
  const y1 = clamp01(Math.max(...box.map((p) => p.y)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

type Placed = Pick<PhotoLayer, 'position' | 'w' | 'h' | 'rotation' | 'flipH' | 'flipV'>;

/** A `canvasToLayerBox` inverze: a réteg saját 0–1 pontja → vászon-normalizált pont. */
export function layerBoxToCanvas(point: { x: number; y: number }, layer: Placed, canvas: { width: number; height: number }): { x: number; y: number } {
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180;
  let lx = (point.x - 0.5) * layer.w * canvas.width;
  let ly = (point.y - 0.5) * layer.h * canvas.height;
  if (layer.flipH) lx = -lx;
  if (layer.flipV) ly = -ly;
  return {
    x: layer.position.x + (lx * Math.cos(rad) - ly * Math.sin(rad)) / canvas.width,
    y: layer.position.y + (lx * Math.sin(rad) + ly * Math.cos(rad)) / canvas.height,
  };
}

/** Képernyő-pixeles húzás a réteg saját terébe vetítve (forgatott/tükrözött rétegen is). */
export function dragInLayer(
  start: { x: number; y: number },
  dxPx: number,
  dyPx: number,
  layer: Placed,
  box: { w: number; h: number }
): { x: number; y: number } {
  const canvas = { width: box.w, height: box.h };
  const p = layerBoxToCanvas(start, layer, canvas);
  return canvasToLayerBox({ x: p.x + dxPx / box.w, y: p.y + dyPx / box.h }, layer, canvas);
}

/**
 * A dobozon kívülre húzott node után a path dobozát a tényleges pontokra igazítja, úgy, hogy
 * a forma a vásznon a helyén marad (különben elavulna a kijelölő keret és a befoglaló).
 * Ha minden pont a dobozon belül van, az eredeti réteget adja vissza.
 */
export function renormalizePathLayer(layer: ShapeLayer, canvas: { width: number; height: number }): ShapeLayer {
  const pts = layer.points;
  if (!pts || pts.length === 0) {
    return layer;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of pts) {
    for (const q of [p, p.h1, p.h2]) {
      if (q) {
        xs.push(q.x);
        ys.push(q.y);
      }
    }
  }
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1) {
    return layer;
  }
  const sx = Math.max(x1 - x0, 1e-4);
  const sy = Math.max(y1 - y0, 1e-4);
  const map = <T extends { x: number; y: number }>(q: T): T => ({ ...q, x: (q.x - x0) / sx, y: (q.y - y0) / sy });
  const points = pts.map((p): PathPoint => {
    const out = map(p);
    if (p.h1) out.h1 = map(p.h1);
    if (p.h2) out.h2 = map(p.h2);
    return out;
  });
  return {
    ...layer,
    points,
    position: layerBoxToCanvas({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, layer, canvas),
    w: layer.w * sx,
    h: layer.h * sy,
  };
}

/** Fok −180…180 közé (a csúszka tartománya; a forgató fogó korlátlan értéket ír). */
export function normalizeRotation(deg: number): number {
  const r = ((deg + 180) % 360 + 360) % 360 - 180;
  return r === -180 ? 180 : r;
}

/** Egy réteg pontos méretei képpontban: bal felső sarok (forgatás nélkül), méret, szög. */
export interface LayerBoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export function layerBoxPx(layer: Placed, canvas: { width: number; height: number }): LayerBoxPx {
  const w = layer.w * canvas.width;
  const h = layer.h * canvas.height;
  return {
    x: Math.round(layer.position.x * canvas.width - w / 2),
    y: Math.round(layer.position.y * canvas.height - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    rotation: normalizeRotation(layer.rotation ?? 0),
  };
}

/**
 * Számmezők módosítása → réteg-patch. A bal felső sarok tartott, `lockAspect` mellett a
 * másik oldal arányosan követi. Érvénytelen vagy nulla méretet nem fogad el.
 */
export function applyLayerBoxPx(
  layer: Placed,
  patch: Partial<LayerBoxPx>,
  canvas: { width: number; height: number },
  lockAspect: boolean
): Pick<PhotoLayer, 'position' | 'w' | 'h' | 'rotation'> {
  const cur = layerBoxPx(layer, canvas);
  const next = { ...cur, ...patch };
  if (!(next.w >= 1) || !(next.h >= 1)) {
    next.w = cur.w;
    next.h = cur.h;
  }
  if (lockAspect && cur.w > 0 && cur.h > 0) {
    if (patch.w != null) {
      next.h = Math.max(1, Math.round((next.w * cur.h) / cur.w));
    } else if (patch.h != null) {
      next.w = Math.max(1, Math.round((next.h * cur.w) / cur.h));
    }
  }
  return {
    position: { x: (next.x + next.w / 2) / canvas.width, y: (next.y + next.h / 2) / canvas.height },
    w: next.w / canvas.width,
    h: next.h / canvas.height,
    rotation: next.rotation,
  };
}
