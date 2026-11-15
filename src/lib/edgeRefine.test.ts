import { densify, gradientMagnitude, refineRingToEdges } from '@/lib/edgeRefine';
import { selectionContains } from '@/lib/selection';

/** 200×200-as kép: világos alapon sötét kör (középpont 100,100, sugár 50) */
const W = 200;
const disc = (() => {
  const px = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const v = Math.hypot(x - 100, y - 100) <= 50 ? 40 : 220;
    px.set([v, v, v, 255], (y * W + x) * 4);
  }
  return px;
})();
const ring = (r: number, jitter = 0) =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const rr = r + (i % 2 ? jitter : -jitter);
    return { x: 100 + rr * Math.cos(a), y: 100 + rr * Math.sin(a) };
  });
/** metszet / unió a valódi körrel, 2 px-es rácson */
const iou = (poly: { x: number; y: number }[]) => {
  const sel = { ops: [{ op: 'add' as const, points: poly }], feather: 0, invert: false };
  let [i, u] = [0, 0];
  for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) {
    const a = selectionContains(sel, { x, y });
    const b = Math.hypot(x - 100, y - 100) <= 50;
    if (a && b) i += 1;
    if (a || b) u += 1;
  }
  return i / u;
};

describe('🧲 S17: él-finomítás', () => {
  const grad = gradientMagnitude(disc, W, W);

  it('a gradiens az élen erős, a sík területen nulla', () => {
    expect(grad[100 * W + 150]).toBeGreaterThan(200);
    expect(grad[100 * W + 100]).toBe(0);
    expect(grad[10 * W + 10]).toBe(0);
  });

  it('a sűrítés legfeljebb 2 px-es lépést hagy', () => {
    const d = densify([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    for (let i = 0; i < d.length; i++) {
      const [a, b] = [d[i], d[(i + 1) % d.length]];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('a túl tág és csipkés kijelölés a kör élére húzódik', () => {
    const rough = ring(58, 4);
    const before = iou(rough);
    const after = iou(refineRingToEdges(grad, W, W, rough, 14));
    expect(before).toBeLessThan(0.8);
    expect(after).toBeGreaterThan(0.95);
  });

  it('a túl szűk kijelölés is kifelé igazodik', () => {
    expect(iou(refineRingToEdges(grad, W, W, ring(43), 12))).toBeGreaterThan(0.95);
  });

  it('él nélkül a kijelölés a helyén marad (terület és súlypont)', () => {
    // a sík sarokban egy 27 px sugarú kör: 6 px-en belül nincs él
    const far = ring(90).map((p) => ({ x: (p.x - 100) * 0.3 + 40, y: (p.y - 100) * 0.3 + 40 }));
    const out = refineRingToEdges(grad, W, W, far, 6);
    const area = (q: { x: number; y: number }[]) => Math.abs(q.reduce((acc, p, i) => acc + (q[(i + q.length - 1) % q.length].x + p.x) * (q[(i + q.length - 1) % q.length].y - p.y), 0)) / 2;
    const cx = (q: { x: number; y: number }[]) => q.reduce((acc, p) => acc + p.x, 0) / q.length;
    expect(Math.abs(area(out) / area(far) - 1)).toBeLessThan(0.05);
    expect(Math.abs(cx(out) - cx(far))).toBeLessThan(1);
  });
});
