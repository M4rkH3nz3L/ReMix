import type { ImageGrid } from '@/types/project';

/**
 * 🔲 Rács a logó- és ikonrajzoláshoz (pure). A méret dokumentum-pixelben van, így a rács a vászon
 * nagyításától független. Csak a szerkesztőben él, az exportba nem kerül.
 */
export const GRID_SIZES = [8, 16, 32, 64];
export const DEFAULT_GRID: ImageGrid = { size: 32, show: true, snap: true };
/** ennél sűrűbb vonalak már nem látszanának, csak szürkítenék a képet */
const MIN_LINE_GAP = 6;

type Size = { width: number; height: number };

const snap1 = (v: number, step: number) => Math.round(v / step) * step;

/** Egy vászon-pont (0–1) a legközelebbi rácspontra. */
export function snapPointToGrid(p: { x: number; y: number }, grid: ImageGrid | undefined, canvas: Size): { x: number; y: number } {
  if (!grid?.snap || !(grid.size > 0)) {
    return p;
  }
  return { x: snap1(p.x * canvas.width, grid.size) / canvas.width, y: snap1(p.y * canvas.height, grid.size) / canvas.height };
}

/** Réteg-középpont úgy, hogy a bal felső sarka üljön a rácson: a méret nem változik. */
export function snapBoxToGrid(center: { x: number; y: number }, size: { w: number; h: number }, grid: ImageGrid | undefined, canvas: Size): { x: number; y: number } {
  const corner = snapPointToGrid({ x: center.x - size.w / 2, y: center.y - size.h / 2 }, grid, canvas);
  return { x: corner.x + size.w / 2, y: corner.y + size.h / 2 };
}

/** A kirajzolandó vonalak helye 0–1-ben; a túl sűrű rácsot a nézet nem rajzolja ki. */
export function gridLines(grid: ImageGrid | undefined, canvas: Size, view: { w: number; h: number }): { xs: number[]; ys: number[] } {
  if (!grid?.show || !(grid.size > 0) || (grid.size / canvas.width) * view.w < MIN_LINE_GAP) {
    return { xs: [], ys: [] };
  }
  const lines = (total: number) => Array.from({ length: Math.floor(total / grid.size) }, (_, i) => ((i + 1) * grid.size) / total).filter((v) => v < 1);
  return { xs: lines(canvas.width), ys: lines(canvas.height) };
}
