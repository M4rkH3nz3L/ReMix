// 🧩 Forma-minta (shape pattern) — a kliens [src/lib/shapePattern.ts] TÜKRE.
// A tile-geometriát és az SVG `<pattern>` stringet ADJA, hogy a worker-render
// és az előnézet (react-native-svg) SZÓ SZERINT egyezzen (contract-teszt védi:
// src/lib/shapePattern.contract.test.ts).
const PATTERN_PRESETS = ['dots', 'grid', 'stripes', 'checker'];
const patRound = (v) => Math.round(v * 1e3) / 1e3;
const patClamp01 = (v) => Math.min(1, Math.max(0, v));

/** egy csempe primitívjei px-ben (a `boxH` a doboz magassága). */
function patternTileJs(p, boxH) {
  const tile = Math.max(4, (p.size / 100) * boxH);
  const fg = p.fg;
  const prims = [];
  switch (p.preset) {
    case 'dots':
      prims.push({ t: 'circle', cx: tile / 2, cy: tile / 2, r: tile * 0.22, fill: fg });
      break;
    case 'grid': {
      const sw = Math.max(1, tile * 0.08);
      prims.push({ t: 'line', x1: 0, y1: sw / 2, x2: tile, y2: sw / 2, stroke: fg, sw });
      prims.push({ t: 'line', x1: sw / 2, y1: 0, x2: sw / 2, y2: tile, stroke: fg, sw });
      break;
    }
    case 'stripes':
      prims.push({ t: 'rect', x: 0, y: 0, w: tile / 2, h: tile, fill: fg });
      break;
    case 'checker': {
      const hh = tile / 2;
      prims.push({ t: 'rect', x: 0, y: 0, w: hh, h: hh, fill: fg });
      prims.push({ t: 'rect', x: hh, y: hh, w: hh, h: hh, fill: fg });
      break;
    }
  }
  return { tile: patRound(tile), prims, bg: p.bg };
}

function patternPrimToSvgJs(pr) {
  if (pr.t === 'rect')
    return `<rect x="${patRound(pr.x)}" y="${patRound(pr.y)}" width="${patRound(
      pr.w
    )}" height="${patRound(pr.h)}" fill="${pr.fill}"/>`;
  if (pr.t === 'circle')
    return `<circle cx="${patRound(pr.cx)}" cy="${patRound(pr.cy)}" r="${patRound(
      pr.r
    )}" fill="${pr.fill}"/>`;
  return `<line x1="${patRound(pr.x1)}" y1="${patRound(pr.y1)}" x2="${patRound(
    pr.x2
  )}" y2="${patRound(pr.y2)}" stroke="${pr.stroke}" stroke-width="${patRound(pr.sw)}"/>`;
}

/** teljes SVG `<pattern>` def (userSpaceOnUse) a `boxW`×`boxH` dobozhoz. */
function shapePatternSvgDefJs(p, id, boxW, boxH) {
  const { tile, prims, bg } = patternTileJs(p, boxH);
  const rot = p.rotation
    ? ` patternTransform="rotate(${patRound(p.rotation)} ${patRound(boxW / 2)} ${patRound(
        boxH / 2
      )})"`
    : '';
  const op = (p.opacity ?? 1) < 1 ? ` opacity="${patRound(patClamp01(p.opacity ?? 1))}"` : '';
  const bgRect = bg ? `<rect x="0" y="0" width="${tile}" height="${tile}" fill="${bg}"/>` : '';
  const body = bgRect + prims.map(patternPrimToSvgJs).join('');
  const inner = op ? `<g${op}>${body}</g>` : body;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}"${rot}>${inner}</pattern>`;
}

function isRenderableShapePatternJs(p) {
  return !!p && (p.opacity ?? 1) > 0 && p.size > 0 && PATTERN_PRESETS.includes(p.preset);
}

module.exports = { patternTileJs, patternPrimToSvgJs, shapePatternSvgDefJs, isRenderableShapePatternJs };
