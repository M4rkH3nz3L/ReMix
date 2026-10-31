/**
 * 📐 Réteg-méretezés sarokfogóval (pure). A SZEMKÖZTI sarok áll, a húzott sarok követi az
 * ujjat, a skála a keret ÁTLÓJÁRA vetített elmozdulásból jön: oldalirányú mozgás nem
 * változtat méretet, és a sarok nem tud átfordulni a másik oldalra. Minden érték a húzás
 * KEZDETI állapotából számol, így a sorozatos frissítések nem halmozódnak.
 */
export type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface ResizeStart {
  /** a keret közepe, képernyő-pixelben */
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  rotation: number;
}

export interface ResizeLimits {
  /** a keret rövidebb oldala ennél nem lehet kisebb (px) */
  minSide: number;
  /** a keret hosszabb oldala ennél nem lehet nagyobb (px) */
  maxSide: number;
}

const SIGNS: Record<ResizeCorner, { x: number; y: number }> = {
  tl: { x: -1, y: -1 },
  tr: { x: 1, y: -1 },
  bl: { x: -1, y: 1 },
  br: { x: 1, y: 1 },
};

/** Az új skála és keret-közép a húzás KEZDETÉTŐL mért (`dx`,`dy`) elmozdulásból. */
export function resizeFromCorner(
  start: ResizeStart,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  limits: ResizeLimits
): { factor: number; cx: number; cy: number } {
  const rad = (start.rotation * Math.PI) / 180;
  const sign = SIGNS[corner];
  const lx = sign.x * start.halfW;
  const ly = sign.y * start.halfH;
  // a közép → húzott sarok vektor a forgatott keretben
  const diagX = lx * Math.cos(rad) - ly * Math.sin(rad);
  const diagY = lx * Math.sin(rad) + ly * Math.cos(rad);
  const diagLen = Math.max(1, Math.hypot(diagX, diagY));
  const ux = diagX / diagLen;
  const uy = diagY / diagLen;
  const along = dx * ux + dy * uy;
  const raw = (2 * diagLen + along) / (2 * diagLen);
  const minF = limits.minSide / Math.max(1, 2 * Math.min(start.halfW, start.halfH));
  const maxF = limits.maxSide / Math.max(1, 2 * Math.max(start.halfW, start.halfH));
  const factor = Math.max(Math.min(minF, 1), Math.min(Math.max(maxF, 1), raw));
  // a szemközti sarok a horgony: a közép az átló mentén vándorol
  const shift = diagLen * (factor - 1);
  return { factor, cx: start.cx + ux * shift, cy: start.cy + uy * shift };
}
