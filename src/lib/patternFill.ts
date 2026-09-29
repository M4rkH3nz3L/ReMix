/**
 * 🧱 Pattern-fill mag (Creative Canvas) — pure csempe-minta + tiling.
 *
 * Egy forma/réteg kép- vagy alakzat-csempével tölthető ki, ismétléssel. A
 * méretek a KITÖLTENDŐ DOBOZ arányában (0…1) — így felbontás-független (a
 * projekt normalizált-vászon konvenciója). Két kimenet:
 *   1. `tilePositions` — a csempék elhelyezése px-ben (ELŐNÉZET/canvas rajzhoz),
 *   2. `patternToSvg` — SVG `<pattern>` a RENDERHEZ (`fill="url(#id)"`).
 *
 * A forgatás a `patternTransform`-on (SVG) ill. a réteg-forgatáson keresztül hat
 * — a `tilePositions` forgatás-mentes rácsot ad (a hívó forgatja a konténert).
 */

export type PatternRepeat = 'tile' | 'tile-x' | 'tile-y' | 'no-repeat';

export interface PatternFill {
  /** kép-csempe (`imageUri`) vagy inline alakzat-csempe (`tileSvg`) */
  kind: 'image' | 'shapes';
  imageUri?: string;
  /** egy csempe nyers SVG-tartalma (kind='shapes'); a saját 0…tileW/tileH terében */
  tileSvg?: string;
  repeat: PatternRepeat;
  /** csempe-méret a doboz arányában (0…1) */
  tileWidth: number;
  tileHeight: number;
  /** fázis-eltolás a doboz arányában (0…1) */
  offsetX: number;
  offsetY: number;
  /** rés a csempék közt a csempe arányában (0…1) */
  spacing: number;
  /** globális szorzó a csempe-méretre */
  scale: number;
  /** forgatás (fok) — SVG patternTransform / konténer-forgatás */
  rotation: number;
  /** 0…1 */
  opacity: number;
  /** háttérszín a csempék mögött (hiányzó = átlátszó) */
  backgroundColor?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;
/** biztonsági plafon a csempeszámra (ne fagyjon a rács) */
const MAX_TILES = 10000;

export const DEFAULT_PATTERN: PatternFill = {
  kind: 'image',
  repeat: 'tile',
  tileWidth: 0.25,
  tileHeight: 0.25,
  offsetX: 0,
  offsetY: 0,
  spacing: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

/** új minta az alapokból + felülírással. */
export function createPattern(overrides: Partial<PatternFill> = {}): PatternFill {
  return { ...DEFAULT_PATTERN, ...overrides };
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A csempék elhelyezése a `boxW`×`boxH` dobozban (px). A csempe- és lépés-méret
 * a doboz arányából + `scale`-ből; a fázis a dobozon negatívba is nyúlhat, hogy
 * a szél is fedve legyen. `no-repeat` = egyetlen csempe; `tile-x`/`tile-y` = egy
 * sor/oszlop. A `truncated` jelzi, ha a plafon miatt levágtuk.
 */
export function tilePositions(
  boxW: number,
  boxH: number,
  p: PatternFill
): { tiles: Tile[]; truncated: boolean } {
  const scale = p.scale > 0 ? p.scale : 1;
  const tw = Math.max(1e-4, p.tileWidth * boxW * scale);
  const th = Math.max(1e-4, p.tileHeight * boxH * scale);
  const stepX = tw + p.spacing * tw;
  const stepY = th + p.spacing * th;
  const ox = p.offsetX * boxW;
  const oy = p.offsetY * boxH;

  if (p.repeat === 'no-repeat') {
    return { tiles: [{ x: round(ox), y: round(oy), w: round(tw), h: round(th) }], truncated: false };
  }

  const repX = p.repeat === 'tile' || p.repeat === 'tile-x';
  const repY = p.repeat === 'tile' || p.repeat === 'tile-y';
  // a fázist a doboz elé toljuk, hogy a bal/felső szél is fedve legyen
  let startX = ox;
  if (repX) while (startX > 0) startX -= stepX;
  else startX = ox;
  let startY = oy;
  if (repY) while (startY > 0) startY -= stepY;
  else startY = oy;

  const tiles: Tile[] = [];
  let truncated = false;
  for (let y = startY; y < boxH; y += stepY) {
    for (let x = startX; x < boxW; x += stepX) {
      if (tiles.length >= MAX_TILES) {
        truncated = true;
        break;
      }
      tiles.push({ x: round(x), y: round(y), w: round(tw), h: round(th) });
      if (!repX) break;
    }
    if (truncated) break;
    if (!repY) break;
  }
  return { tiles, truncated };
}

/** az SVG `patternTransform` string (forgatás a doboz közepe körül + eltolás). */
export function patternTransform(p: PatternFill, boxW: number, boxH: number): string {
  const parts: string[] = [];
  if (p.offsetX || p.offsetY) parts.push(`translate(${round(p.offsetX * boxW)} ${round(p.offsetY * boxH)})`);
  if (p.rotation) parts.push(`rotate(${round(p.rotation)} ${round(boxW / 2)} ${round(boxH / 2)})`);
  return parts.join(' ');
}

/**
 * SVG `<pattern>` a `boxW`×`boxH` dobozhoz (userSpaceOnUse). A cella = csempe +
 * rés; a tartalom kép (`<image>`) vagy a megadott alakzat-SVG, `scale`-re méretezve.
 * A hívó `fill="url(#id)"`-del hivatkozik rá.
 */
export function patternToSvg(p: PatternFill, id: string, boxW: number, boxH: number): string {
  const scale = p.scale > 0 ? p.scale : 1;
  const tw = round(Math.max(1e-4, p.tileWidth * boxW * scale));
  const th = round(Math.max(1e-4, p.tileHeight * boxH * scale));
  const cellW = round(tw + p.spacing * tw);
  const cellH = round(th + p.spacing * th);
  const transform = patternTransform(p, boxW, boxH);
  const tf = transform ? ` patternTransform="${transform}"` : '';

  let content = '';
  if (p.backgroundColor) content += `<rect x="0" y="0" width="${cellW}" height="${cellH}" fill="${p.backgroundColor}"/>`;
  const op = p.opacity < 1 ? ` opacity="${round(clamp01(p.opacity))}"` : '';
  if (p.kind === 'image' && p.imageUri) {
    content += `<image href="${p.imageUri}" x="0" y="0" width="${tw}" height="${th}" preserveAspectRatio="none"${op}/>`;
  } else if (p.kind === 'shapes' && p.tileSvg) {
    content += op ? `<g${op}>${p.tileSvg}</g>` : p.tileSvg;
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${cellW}" height="${cellH}"${tf}>${content}</pattern>`;
}

/** van-e ténylegesen rajzolható tartalma a mintának? */
export function isRenderablePattern(p: PatternFill): boolean {
  if (p.opacity <= 0) return false;
  if (p.kind === 'image') return !!p.imageUri;
  return !!p.tileSvg;
}
