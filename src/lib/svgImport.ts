import type { ImageLayer } from '@/types/project';
import { collectGradients } from './svg/gradients';
import { readViewBox, walkLayers } from './svg/layers';
import { IDENTITY } from './svg/matrix';
import type { Style } from './svg/style';
import { parseXml, type XmlNode } from './svg/xml';

/**
 * 📥 SVG import mag — egy SVG-dokumentum → `ImageDoc`-réteg-lista (pure).
 *
 * A `designSystem.ts:shapesToSvg` az EXPORT; ez az IMPORT párja. Könnyű,
 * függőség-mentes XML-walker (nincs DOM/expo). Támogatott elemek: `rect`,
 * `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `g`
 * (csoport-transzformmal), plusz a `linearGradient`/`radialGradient` a
 * `<defs>`-ből (`url(#id)` kitöltés). A stílus a prezentációs attribútumokból
 * ÉS a `style="…"` inline-ból jön (utóbbi felülír).
 *
 * Koordináta-rend: a kimenet a projekt konvenciója — a réteg `position` a
 * KÖZÉPPONT 0–1-ben a doksi-dobozban (a `viewBox`/`width`×`height`), `w`/`h`
 * 0–1, a path-pontok a réteg SAJÁT dobozában 0–1 (lásd `vectorPath`).
 *
 * Ismert korlátok: nincs CSS `<style>`-osztály-szelektor, nincs %-egység a
 * viewporthoz, a gradient-`href`-öröklés egy szintű, a transzform-lista
 * kiértékelt (translate/scale/rotate/skewX/skewY/matrix), az arc-flag
 * egybeírás öröklődő korlátja a `vectorPath`-ból.
 */

export interface SvgImportResult {
  /** a forrás viewBox / width szélessége (a doksi-arány számításához) */
  width: number;
  height: number;
  layers: ImageLayer[];
  /** a fájl azon elemei, amiket nem tudtunk beolvasni (tag → darab) — a user megkapja */
  unsupported: Record<string, number>;
}

/** Ismert, de NEM támogatott elemek: csendes eldobás helyett jelentjük őket. */
const UNSUPPORTED_TAGS = new Set(['use', 'symbol', 'clipPath', 'mask', 'image', 'style', 'filter', 'pattern', 'marker', 'foreignObject', 'tspan', 'textPath']);

function countUnsupported(node: XmlNode, out: Record<string, number>): void {
  for (const child of node.children) {
    if (UNSUPPORTED_TAGS.has(child.tag)) {
      out[child.tag] = (out[child.tag] ?? 0) + 1;
    }
    countUnsupported(child, out);
  }
}

// A beolvasó a `svg/` mappában, felelősség szerint bontva (XML, mátrix, stílus, gradiens,
// geometria, elem → réteg); ez a modul a publikus felület.

/** SVG-dokumentum → réteg-lista + doksi-méret. */
export function parseSvg(svg: string): SvgImportResult {
  const root = parseXml(svg);
  if (!root || root.tag !== 'svg') return { width: 0, height: 0, layers: [], unsupported: {} };
  const vb = readViewBox(root);
  const grads = collectGradients(root);
  const layers: ImageLayer[] = [];
  const baseStyle: Style = { fill: '#000000' };
  walkLayers(root, { m: IDENTITY, style: baseStyle, grads, vb }, layers);
  const unsupported: Record<string, number> = {};
  countUnsupported(root, unsupported);
  return { width: vb.w, height: vb.h, layers, unsupported };
}
