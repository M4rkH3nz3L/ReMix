import { simplifyPolygon } from '@/lib/magicWand';
import type { CanvasPoint } from '@/lib/penPath';

/**
 * 🎯 Színtartomány-kijelölés (IMAGE-PROD S17) — pure, expo-mentes. A varázspálca egyetlen ÖSSZEFÜGGŐ
 * régiót ad; a színtartomány a kép MINDEN a mintához hasonló képpontját (Photoshop „Contiguous” ki):
 * több külön régió, bennük lyukak, a lyukakban szigetek. A kimenet a kijelölés műveletlistája
 * (`add` a régió körvonala, `subtract` a lyuké), terület szerint csökkenőben — így a beágyazás helyes
 * (a tartalmazó gyűrű mindig nagyobb). A zajt a legkisebb terület és a gyűrűk száma szűri.
 */

export interface RangeRing {
  op: 'add' | 'subtract';
  /** a kép saját terében, 0–1 */
  points: CanvasPoint[];
}

/** a mintához `tol` euklideszi RGB-távolságon belüli képpontok (1), az átlátszók kimaradnak */
export function colorRangeMask(pixels: ArrayLike<number>, w: number, h: number, color: readonly [number, number, number], tol: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const t2 = tol * tol;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (pixels[p + 3] < 8) continue;
    const dr = pixels[p] - color[0];
    const dg = pixels[p + 1] - color[1];
    const db = pixels[p + 2] - color[2];
    if (dr * dr + dg * dg + db * db <= t2) mask[i] = 1;
  }
  return mask;
}

/** összefüggő komponensek címkézése (`diag`: 8-szomszéd); 0 = nincs címke */
function label(isIn: (i: number) => boolean, w: number, h: number, diag: boolean) {
  const labels = new Int32Array(w * h);
  const first: number[] = [];
  const area: number[] = [];
  const border: boolean[] = [];
  const stack: number[] = [];
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (labels[s] || !isIn(s)) continue;
    n += 1;
    labels[s] = n;
    first.push(s);
    let a = 0;
    let edge = false;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop() as number;
      a += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || (!diag && dx !== 0 && dy !== 0)) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!labels[j] && isIn(j)) {
          labels[j] = n;
          stack.push(j);
        }
      }
    }
    area.push(a);
    border.push(edge);
  }
  return { labels, first, area, border, count: n };
}

const NEIGH: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** Moore-szomszéd kontúrkövetés a komponens legfelső-legbaloldalibb képpontjából (képpont-középpontokon) */
function trace(inside: (x: number, y: number) => boolean, sx: number, sy: number, limit: number): CanvasPoint[] {
  const out: CanvasPoint[] = [];
  let [cx, cy, bx, by] = [sx, sy, sx - 1, sy];
  let safety = limit;
  do {
    out.push({ x: cx, y: cy });
    const start = NEIGH.findIndex((d) => d[0] === bx - cx && d[1] === by - cy);
    const from = start < 0 ? 0 : start;
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const k = (from + i) % 8;
      const nx = cx + NEIGH[k][0];
      const ny = cy + NEIGH[k][1];
      if (inside(nx, ny)) {
        const pk = (from + i - 1) % 8;
        [bx, by, cx, cy] = [cx + NEIGH[pk][0], cy + NEIGH[pk][1], nx, ny];
        found = true;
        break;
      }
    }
    if (!found || --safety <= 0) break;
  } while (!(cx === sx && cy === sy));
  return out;
}

function shoelace(p: CanvasPoint[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
  return Math.abs(a) / 2;
}

/**
 * A maszk gyűrűi: minden régió körvonala (`add`) és a lyukai (`subtract`), terület szerint csökkenőben.
 * `minArea`: ennél kisebb régió / lyuk (képpontban) kimarad; `maxRings`: a legnagyobbak maradnak.
 */
export function maskToRings(mask: Uint8Array, w: number, h: number, opts: { minArea?: number; maxRings?: number; simplifyPx?: number } = {}): RangeRing[] {
  const minArea = opts.minArea ?? Math.max(4, Math.round(w * h * 0.0002));
  const maxRings = opts.maxRings ?? 64;
  const fg = label((i) => mask[i] === 1, w, h, true);
  // a háttér 4-szomszédos (a 8-szomszédos előtér duálja): a szélet nem érintő háttér-komponens lyuk
  const bg = label((i) => mask[i] === 0, w, h, false);
  const rings: { op: 'add' | 'subtract'; points: CanvasPoint[]; area: number }[] = [];
  const add = (lab: Int32Array, k: number, first: number, op: 'add' | 'subtract') => {
    const sx = first % w;
    const sy = (first - sx) / w;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === k;
    const raw = trace(inside, sx, sy, w * h * 8 + 16);
    const pts = simplifyPolygon(raw, Math.max(0.5, opts.simplifyPx ?? 1.5));
    if (pts.length < 3) return;
    rings.push({ op, points: pts, area: shoelace(pts) });
  };
  for (let k = 1; k <= fg.count; k++) if (fg.area[k - 1] >= minArea) add(fg.labels, k, fg.first[k - 1], 'add');
  for (let k = 1; k <= bg.count; k++) if (!bg.border[k - 1] && bg.area[k - 1] >= minArea) add(bg.labels, k, bg.first[k - 1], 'subtract');
  rings.sort((a, b) => b.area - a.area);
  return rings.slice(0, maxRings).map((r) => ({ op: r.op, points: r.points.map((p) => ({ x: p.x / w, y: p.y / h })) }));
}

/** a teljes lánc: a minta színe a (sx, sy) képpontból, a hasonló színű képpontok gyűrűi */
export function colorRangeRings(pixels: ArrayLike<number>, w: number, h: number, sx: number, sy: number, tol: number): RangeRing[] {
  const p = (sy * w + sx) * 4;
  return maskToRings(colorRangeMask(pixels, w, h, [pixels[p], pixels[p + 1], pixels[p + 2]], tol), w, h);
}
