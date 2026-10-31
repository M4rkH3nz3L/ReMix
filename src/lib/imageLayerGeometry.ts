import type { PhotoLayer } from '@/types/project';

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
