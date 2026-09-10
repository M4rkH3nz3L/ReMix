/**
 * 🙈 Arc-régió számítás (pure — react-native import NÉLKÜL, hogy tesztelhető
 * legyen; a hálózati rész a faceClient.ts-ben van).
 */

export interface FaceBoxLike {
  /** középpont + méret, vászon-normalizálva */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Több mintavett kocka ÖSSZES arcának befoglaló doboza + margó — a statikus
 * régió így a fejmozgást is lefedi (a render gyors marad, mert nem kell
 * per-frame maszk).
 */
export function faceUnionRegion(
  frames: FaceBoxLike[][],
  padding = 0.35
): { x: number; y: number; w: number; h: number } | null {
  const all = frames.flat();
  if (all.length === 0) {
    return null;
  }
  let x1 = 1;
  let y1 = 1;
  let x2 = 0;
  let y2 = 0;
  for (const f of all) {
    x1 = Math.min(x1, f.x - f.w / 2);
    y1 = Math.min(y1, f.y - f.h / 2);
    x2 = Math.max(x2, f.x + f.w / 2);
    y2 = Math.max(y2, f.y + f.h / 2);
  }
  const padW = (x2 - x1) * padding;
  const padH = (y2 - y1) * padding;
  x1 = Math.max(0, x1 - padW);
  y1 = Math.max(0, y1 - padH);
  x2 = Math.min(1, x2 + padW);
  y2 = Math.min(1, y2 + padH);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: round((x1 + x2) / 2),
    y: round((y1 + y2) / 2),
    w: round(x2 - x1),
    h: round(y2 - y1),
  };
}
