import type { CanvasPoint } from '@/lib/penPath';

/**
 * 🪄 Varázspálca-mag (TISZTA, expo-mentes, tesztelt). A nyers RGBA pixel-tömbön
 * dolgozik (a Skia `readPixels()` adja a glue-ban): flood-fill a kattintás-pontból
 * szín-hasonlóság alapján → maszk → Moore-kontúrkövetés → egyszerűsített,
 * NORMALIZÁLT (0–1) körvonal, amiből path-forma lesz. Az algoritmus önmagában
 * bizonyíthatóan működik (nincs natív függése).
 */

const IDX = (x: number, y: number, w: number) => y * w + x;

/**
 * 4-szomszédos flood-fill a (sx,sy) magból: a magpixelhez `tol` euklideszi
 * RGB-távolságon belüli, ÖSSZEFÜGGŐ régió maszkja (1 = kijelölt).
 */
export function floodFillMask(
  pixels: Uint8Array | Uint8ClampedArray | number[],
  w: number,
  h: number,
  sx: number,
  sy: number,
  tol = 32
): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
    return mask;
  }
  const seed = IDX(sx, sy, w) * 4;
  const sr = pixels[seed];
  const sg = pixels[seed + 1];
  const sb = pixels[seed + 2];
  const tol2 = tol * tol;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      continue;
    }
    const m = IDX(x, y, w);
    if (mask[m]) {
      continue;
    }
    const p = m * 4;
    const dr = pixels[p] - sr;
    const dg = pixels[p + 1] - sg;
    const db = pixels[p + 2] - sb;
    if (dr * dr + dg * dg + db * db > tol2) {
      continue;
    }
    mask[m] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return mask;
}

const isSet = (mask: Uint8Array, w: number, h: number, x: number, y: number) =>
  x >= 0 && y >= 0 && x < w && y < h && mask[IDX(x, y, w)] === 1;

// óramutató szerinti 8-szomszéd (K-ról indulva)
const NEIGH: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * A maszk KÜLSŐ határának Moore-szomszéd követése → rendezett pixel-poligon
 * (óramutató szerint). A legfelső-legbaloldalibb maszkpixelből indul.
 */
export function maskToPolygon(mask: Uint8Array, w: number, h: number): CanvasPoint[] {
  let sx = -1;
  let sy = -1;
  for (let y = 0; y < h && sy < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[IDX(x, y, w)]) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) {
    return [];
  }
  const contour: CanvasPoint[] = [];
  let cx = sx;
  let cy = sy;
  // a "honnan jöttünk" pixel: a start-tól nyugatra (háttér)
  let bx = sx - 1;
  let by = sy;
  let safety = w * h * 8 + 16;
  do {
    contour.push({ x: cx, y: cy });
    const start = NEIGH.findIndex((d) => d[0] === bx - cx && d[1] === by - cy);
    const from = start < 0 ? 0 : start;
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const idx = (from + i) % 8;
      const nx = cx + NEIGH[idx][0];
      const ny = cy + NEIGH[idx][1];
      if (isSet(mask, w, h, nx, ny)) {
        const pidx = (from + i - 1) % 8;
        bx = cx + NEIGH[pidx][0];
        by = cy + NEIGH[pidx][1];
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) {
      break; // izolált pixel
    }
    if (--safety <= 0) {
      break;
    }
  } while (!(cx === sx && cy === sy));
  return contour;
}

/** távolság-alapú ritkítás (a lasszóhoz hasonló): a közeli pontokat eldobja */
export function simplifyPolygon(points: CanvasPoint[], minDist: number): CanvasPoint[] {
  if (points.length <= 3) {
    return points;
  }
  const out: CanvasPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
    }
  }
  return out;
}

/**
 * 🪄 A teljes lánc: pixelek + kattintás-pont → NORMALIZÁLT (0–1), egyszerűsített
 * kijelölés-körvonal (vagy null, ha nincs értelmes régió). A `tolerance` a
 * szín-hasonlóság, a `simplifyPx` a ritkítás pixelben.
 */
export function magicWandOutline(
  pixels: Uint8Array | Uint8ClampedArray | number[],
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance = 32,
  simplifyPx = 2
): CanvasPoint[] | null {
  const mask = floodFillMask(pixels, w, h, sx, sy, tolerance);
  const poly = maskToPolygon(mask, w, h);
  if (poly.length < 3) {
    return null;
  }
  const simplified = simplifyPolygon(poly, Math.max(0.5, simplifyPx));
  if (simplified.length < 3) {
    return null;
  }
  // NORMALIZÁLÁS a pixel-méretre (0–1) — a path-forma ezt várja
  return simplified.map((p) => ({ x: p.x / w, y: p.y / h }));
}
