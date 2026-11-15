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

/** S18: oldal-fogó — a keret egyik oldala, a szemközti oldal áll (nem arányos méretezés) */
export type ResizeEdge = 'l' | 'r' | 't' | 'b';

const EDGE_SIGNS: Record<ResizeEdge, { x: number; y: number }> = {
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
  t: { x: 0, y: -1 },
  b: { x: 0, y: 1 },
};

/**
 * Az új fél-szélesség/-magasság és keret-közép az oldal-fogó húzásából: az elmozdulás a forgatott keret
 * oldal-normálisára vetül, csak az a tengely változik, a szemközti oldal a helyén marad; a méret a
 * `minSide`…`maxSide` közé esik (az oldal nem fordulhat át a másik oldalra).
 */
export function resizeFromEdge(
  start: ResizeStart,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  limits: ResizeLimits
): { halfW: number; halfH: number; cx: number; cy: number } {
  const rad = (start.rotation * Math.PI) / 180;
  const sign = EDGE_SIGNS[edge];
  // az oldal kifelé mutató normálisa a forgatott keretben
  const nx = sign.x * Math.cos(rad) - sign.y * Math.sin(rad);
  const ny = sign.x * Math.sin(rad) + sign.y * Math.cos(rad);
  const along = dx * nx + dy * ny;
  const horizontal = sign.x !== 0;
  const from = 2 * (horizontal ? start.halfW : start.halfH);
  const size = Math.max(limits.minSide, Math.min(limits.maxSide, from + along));
  const grow = size - from;
  // a közép a növekmény felével mozdul az oldal felé: a szemközti oldal áll
  return {
    halfW: horizontal ? size / 2 : start.halfW,
    halfH: horizontal ? start.halfH : size / 2,
    cx: start.cx + (nx * grow) / 2,
    cy: start.cy + (ny * grow) / 2,
  };
}
