import { simplifyPolygon } from '@/lib/magicWand';
import type { CanvasPoint } from '@/lib/penPath';

/**
 * 🧲 Él-finomítás: a durva kijelölés (lasszó, kézi forma) a kép valódi éleire húzva (IMAGE-PROD S17).
 * Pure, expo-mentes. A luma Sobel-gradiense egyszer számolódik; a körvonal sűrítve, minden pont a saját
 * normálisa mentén `radius` képponton belül a legerősebb élre ugrik (ha van elég erős él), utána
 * simítás és ritkítás. Gyenge él mellett a pont a helyén marad — a kijelölés nem „esik szét".
 */

/** a luma Sobel-gradiensének nagysága (0–~1440), képpontonként */
export function gradientMagnitude(pixels: ArrayLike<number>, w: number, h: number): Float32Array {
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) luma[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const at = (dx: number, dy: number) => luma[(y + dy) * w + x + dx];
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      g[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return g;
}

/** a zárt körvonal sűrítése: két pont között legfeljebb `step` képpont */
export function densify(ring: CanvasPoint[], step: number): CanvasPoint[] {
  const out: CanvasPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * Egy zárt körvonal (kép-képpontban) az élekre húzva. `radius`: a keresés távolsága a normális mentén;
 * `minEdge`: ennél gyengébb él mellett a pont marad.
 */
export function refineRingToEdges(grad: Float32Array, w: number, h: number, ring: CanvasPoint[], radius = 12, minEdge = 80): CanvasPoint[] {
  if (ring.length < 3) return ring;
  const pts = densify(ring, 2);
  const n = pts.length;
  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1 ? 0 : grad[yi * w + xi];
  };
  const moved = pts.map((p, i) => {
    const [a, b] = [pts[(i - 2 + n) % n], pts[(i + 2) % n]];
    const [tx, ty] = [b.x - a.x, b.y - a.y];
    const len = Math.hypot(tx, ty) || 1;
    const [nx, ny] = [-ty / len, tx / len];
    let best = 0;
    let bestT = 0;
    for (let t = -radius; t <= radius; t += 0.5) {
      const v = at(p.x + nx * t, p.y + ny * t);
      // egyenlő erősségnél a közelebbi él nyer
      if (v > best + 1e-6 || (Math.abs(v - best) <= 1e-6 && Math.abs(t) < Math.abs(bestT))) {
        best = v;
        bestT = t;
      }
    }
    return best >= minEdge ? { x: p.x + nx * bestT, y: p.y + ny * bestT } : p;
  });
  // simítás (5 pontos mozgóátlag), hogy egy-egy zajos élpont ne csipkézze a körvonalat
  const smooth = moved.map((_, i) => {
    let sx = 0;
    let sy = 0;
    for (let k = -2; k <= 2; k++) {
      const q = moved[(i + k + n) % n];
      sx += q.x;
      sy += q.y;
    }
    return { x: sx / 5, y: sy / 5 };
  });
  const out = simplifyPolygon(smooth, 1.5);
  return out.length >= 3 ? out : ring;
}
