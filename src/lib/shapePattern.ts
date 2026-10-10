/**
 * 🧩 Forma-minta (shape pattern) mag — Photoshop-szerű csempe-minták a formákra.
 *
 * Egy forma-réteg ismétlődő geometrikus mintával tölthető ki (pöttyök / rács /
 * csíkok / sakktábla). A kulcs a **render-parity**: EGY leírásból
 * ([patternTile]) két fogyasztó dolgozik, ezért az előnézet és a beégetett kép
 * garantáltan egyezik:
 *   1. a **worker** az SVG `<pattern>` stringet injektálja (Chromium),
 *   2. az **előnézet** ([ShapeOverlay](../components/preview/ShapeOverlay.tsx)) a
 *      SZÓ SZERINT UGYANAZOKAT a primitíveket rajzolja react-native-svg-vel.
 *
 * A méret a kitöltendő doboz MAGASSÁGÁNAK %-a (felbontás-független, a projekt
 * normalizált-vászon konvenciója). A modul szándékosan expo/RN-mentes (tesztelhető).
 */

import type { PatternPreset, ShapePattern } from '@/types/project';

// a típus a types/project.ts-ben él (körkörös import ellen, az AdjustmentLayer
// mintájára) — itt re-exportáljuk, hogy a magot önállóan is lehessen importálni
export type { PatternPreset, ShapePattern };

export const PATTERN_PRESETS: PatternPreset[] = ['dots', 'grid', 'stripes', 'checker'];

export const DEFAULT_SHAPE_PATTERN: ShapePattern = {
  preset: 'dots',
  fg: '#ffffff',
  size: 8,
  rotation: 0,
  opacity: 1,
};

/** új minta az alapokból + felülírással. */
export function createShapePattern(overrides: Partial<ShapePattern> = {}): ShapePattern {
  return { ...DEFAULT_SHAPE_PATTERN, ...overrides };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1e3) / 1e3;

/** a csempe egy rajz-primitívje a saját 0…tile terében (bg NÉLKÜL). */
export type PatternPrim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number };

export interface PatternTile {
  /** csempe-oldal (px) */
  tile: number;
  /** a csempe tartalma (a háttér külön, a `bg`-ben) */
  prims: PatternPrim[];
  bg?: string;
}

const roundPrim = (p: PatternPrim): PatternPrim => {
  switch (p.t) {
    case 'rect':
      return { t: 'rect', x: round(p.x), y: round(p.y), w: round(p.w), h: round(p.h), fill: p.fill };
    case 'circle':
      return { t: 'circle', cx: round(p.cx), cy: round(p.cy), r: round(p.r), fill: p.fill };
    case 'line':
      return {
        t: 'line',
        x1: round(p.x1),
        y1: round(p.y1),
        x2: round(p.x2),
        y2: round(p.y2),
        stroke: p.stroke,
        sw: round(p.sw),
      };
  }
};

/**
 * A minta egy csempéjének leírása px-ben (a `boxH` a kitöltendő doboz magassága).
 * A tiling a csempe ismétlésével adódik — a primitíveket úgy rajzoljuk, hogy a
 * csempe-határon folytonosan folytatódjanak (rács: felső+bal él; csík: fél-csempe;
 * sakktábla: két átlós cella).
 */
export function patternTile(p: ShapePattern, boxH: number): PatternTile {
  const tile = Math.max(4, (p.size / 100) * boxH);
  const fg = p.fg;
  const prims: PatternPrim[] = [];
  switch (p.preset) {
    case 'dots': {
      prims.push({ t: 'circle', cx: tile / 2, cy: tile / 2, r: tile * 0.22, fill: fg });
      break;
    }
    case 'grid': {
      const sw = Math.max(1, tile * 0.08);
      // felső + bal él → tiling-gel egyenletes rács
      prims.push({ t: 'line', x1: 0, y1: sw / 2, x2: tile, y2: sw / 2, stroke: fg, sw });
      prims.push({ t: 'line', x1: sw / 2, y1: 0, x2: sw / 2, y2: tile, stroke: fg, sw });
      break;
    }
    case 'stripes': {
      // fél-csempe függőleges sáv → tiling-gel egyenlő csíkok
      prims.push({ t: 'rect', x: 0, y: 0, w: tile / 2, h: tile, fill: fg });
      break;
    }
    case 'checker': {
      const h = tile / 2;
      prims.push({ t: 'rect', x: 0, y: 0, w: h, h, fill: fg });
      prims.push({ t: 'rect', x: h, y: h, w: h, h, fill: fg });
      break;
    }
  }
  return { tile: round(tile), prims: prims.map(roundPrim), bg: p.bg };
}

/** egy primitív → SVG-elem string (a worker-render számára). */
export function patternPrimToSvg(pr: PatternPrim): string {
  switch (pr.t) {
    case 'rect':
      return `<rect x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${pr.h}" fill="${pr.fill}"/>`;
    case 'circle':
      return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${pr.fill}"/>`;
    case 'line':
      return `<line x1="${pr.x1}" y1="${pr.y1}" x2="${pr.x2}" y2="${pr.y2}" stroke="${pr.stroke}" stroke-width="${pr.sw}"/>`;
  }
}

/**
 * Teljes SVG `<pattern>` def a `boxW`×`boxH` dobozhoz (userSpaceOnUse). A hívó
 * `fill="url(#id)"`-del hivatkozik rá. A forgatás `patternTransform`-mal, a
 * minta-átlátszóság a csempe-tartalom csoport-opacityjével. A worker ezt a
 * stringet használja; az előnézet ugyanezekből a primitívekből react-native-svg-t rajzol.
 */
export function shapePatternSvgDef(
  p: ShapePattern,
  id: string,
  boxW: number,
  boxH: number
): string {
  const { tile, prims, bg } = patternTile(p, boxH);
  const rot = p.rotation
    ? ` patternTransform="rotate(${round(p.rotation)} ${round(boxW / 2)} ${round(boxH / 2)})"`
    : '';
  const op = (p.opacity ?? 1) < 1 ? ` opacity="${round(clamp01(p.opacity ?? 1))}"` : '';
  const bgRect = bg ? `<rect x="0" y="0" width="${tile}" height="${tile}" fill="${bg}"/>` : '';
  const body = bgRect + prims.map(patternPrimToSvg).join('');
  const inner = op ? `<g${op}>${body}</g>` : body;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}"${rot}>${inner}</pattern>`;
}

/** van-e ténylegesen rajzolható tartalma a mintának? */
export function isRenderableShapePattern(p: ShapePattern | undefined | null): p is ShapePattern {
  return !!p && (p.opacity ?? 1) > 0 && p.size > 0 && PATTERN_PRESETS.includes(p.preset);
}
