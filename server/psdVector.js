// 🔷 Shape-réteg → PSD-VEKTOR geometria (VECTOR 03.2). A `psdExport.js` vektor-ága
// használja: a modell `ShapeClip`-jét (rect/ellipse/line/arrow/star/path) a
// Photoshop él-vektor reprezentációjába (`vectorMask` + `vectorFill`[+`vectorStroke`])
// fordítja, hogy a réteg Photoshopban TOVÁBB-SZERKESZTHETŐ vektor-forma maradjon
// (NEM raszter). Ez a `src/lib/svgExport.ts` geometria-matekjának PURE-JS párja:
// ugyanaz a shape→path leképezés (rect/ellipse/line/arrow/star + bezier `points`),
// csak SVG `d` helyett ag-psd `BezierKnot`-okat termel.
//
// KOORDINÁTA-KONVENCIÓK (BIZONYÍTOTT roundtrip-próbával, lásd psdVector.test.js):
//  • A modell forma-dobozában minden pont 0–1 (position = KÖZÉPPONT, w/h a vászon
//    arányában). A `PathPoint`: x/y = HORGONY, h1 = BEJÖVŐ fogó, h2 = KIMENŐ fogó —
//    mind ABSZOLÚT 0–1 a forma-dobozban (`src/lib/vectorPath.ts`).
//  • Az ag-psd JS-oldali API-ján a `vectorMask.paths[].knots[].points` tömb
//    [cpBefore_x, cpBefore_y, anchor_x, anchor_y, cpAfter_x, cpAfter_y] sorrendű,
//    DOKUMENTUM-PIXELBEN (az ag-psd writer osztja el a doc W/H-val, a reader
//    visszaszorozza — a JS-API tehát pixel-koordináta). → a leképezés:
//    [h1→cpBefore, horgony→anchor, h2→cpAfter], a forma-dobozból a doc-pixelbe.
//  • `fill` hex → `vectorFill {type:'color', color:{r,g,b}}` (0–255).
//  • kontúr (`borderColor`/`borderWidth` vagy nyitott path `strokeWidth`) →
//    `vectorStroke` (lineWidth px, cap/join, content szín). A roundtrip igazolja,
//    hogy mindez (fill+stroke+knots) pontosan visszaolvasható.

// ── szín ─────────────────────────────────────────────────────────────────────

/** `#rgb`/`#rrggbb` (vagy `rgb()`/`rgba()`) → {r,g,b} 0–255; hibás → fekete. */
function parseColor(hex) {
  if (typeof hex !== 'string') {
    return { r: 0, g: 0, b: 0 };
  }
  const s = hex.trim();
  // #rgb / #rrggbb
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  // rgb(…) / rgba(…)
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (rgb) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
    return { r: c(rgb[1]), g: c(rgb[2]), b: c(rgb[3]) };
  }
  return { r: 0, g: 0, b: 0 };
}

// ── forma-doboz (a svgExport.boxOf párja, doc-pixelben) ──────────────────────

/**
 * A forma-réteg 0–1 dobozát a doc-pixel dobozába (left/top + bw/bh). A
 * `svgExport.ts:boxOf` pontos párja (position = középpont).
 */
function boxOf(layer, W, H) {
  const bw = (Number(layer.w) || 1) * W;
  const bh = (Number(layer.h) || 1) * H;
  const cx = (layer.position && Number(layer.position.x)) || 0.5;
  const cy = (layer.position && Number(layer.position.y)) || 0.5;
  const px = cx * W;
  const py = cy * H;
  return { bw, bh, cx: px, cy: py, left: px - bw / 2, top: py - bh / 2 };
}

/** egy forma-doboz 0–1 X → doc-pixel X; Y hasonlóan. */
function mapX(nx, b) {
  return b.left + nx * b.bw;
}
function mapY(ny, b) {
  return b.top + ny * b.bh;
}

// ── knot-építők ──────────────────────────────────────────────────────────────

/**
 * Sarokpont-knot (egyenes élek): a fogók EGYBEESNEK a horgonnyal → a szomszédos
 * szegmens egyenes. `[ax,ay, ax,ay, ax,ay]`.
 */
function cornerKnot(x, y) {
  return { linked: false, points: [x, y, x, y, x, y] };
}

/**
 * Egy modell-`PathPoint` (0–1 a forma-dobozban) → ag-psd knot (doc-pixel).
 * h1 = BEJÖVŐ fogó = cpBefore; a horgony az anchor; h2 = KIMENŐ fogó = cpAfter.
 * Hiányzó fogó → a horgony (azaz egyenes szegmens azon az oldalon).
 */
function knotFromPathPoint(p, b) {
  const ax = mapX(p.x, b);
  const ay = mapY(p.y, b);
  const before = p.h1 ? [mapX(p.h1.x, b), mapY(p.h1.y, b)] : [ax, ay];
  const after = p.h2 ? [mapX(p.h2.x, b), mapY(p.h2.y, b)] : [ax, ay];
  // linked = a két fogó szimmetrikus (sima node) — csak vizuális hint a PS-nek
  const linked = Boolean(p.h1 && p.h2);
  return { linked, points: [before[0], before[1], ax, ay, after[0], after[1]] };
}

// ── forma-geometriák (a svgExport matekja, de knot-okká) ─────────────────────

/** téglalap 4 sarok-knot (CW), a doc-pixel dobozból. */
function rectKnots(b) {
  return [
    cornerKnot(b.left, b.top),
    cornerKnot(b.left + b.bw, b.top),
    cornerKnot(b.left + b.bw, b.top + b.bh),
    cornerKnot(b.left, b.top + b.bh),
  ];
}

/**
 * Ellipszis 4 Bézier-knot-tal (kör-approximáció, κ=0.5522847498). Minden knot a
 * fő-pontokon (jobb/alsó/bal/felső), a fogók érintő-irányban — a PS natív
 * ellipszis-vektort így közelítjük (vizuálisan pixel-pontos).
 */
function ellipseKnots(b) {
  const rx = b.bw / 2;
  const ry = b.bh / 2;
  const cx = b.left + rx;
  const cy = b.top + ry;
  const k = 0.5522847498307936;
  const ox = rx * k;
  const oy = ry * k;
  // sorrend: jobb(3h) → alsó(6h) → bal(9h) → felső(12h)
  return [
    { linked: true, points: [cx + rx, cy - oy, cx + rx, cy, cx + rx, cy + oy] }, // jobb
    { linked: true, points: [cx + ox, cy + ry, cx, cy + ry, cx - ox, cy + ry] }, // alsó
    { linked: true, points: [cx - rx, cy + oy, cx - rx, cy, cx - rx, cy - oy] }, // bal
    { linked: true, points: [cx - ox, cy - ry, cx, cy - ry, cx + ox, cy - ry] }, // felső
  ];
}

/** csillag (5 ágú) 10 sarok-knot — a svgExport.starPoints pixel-matekja. */
function starKnots(b) {
  const R = Math.min(b.bw, b.bh) / 2;
  const r = R * 0.5;
  const knots = [];
  for (let kk = 0; kk < 10; kk++) {
    const rad = kk % 2 === 0 ? R : r;
    const ang = (-90 + kk * 36) * (Math.PI / 180);
    knots.push(cornerKnot(b.cx + rad * Math.cos(ang), b.cy + rad * Math.sin(ang)));
  }
  return knots;
}

/** nyíl 7 sarok-knot — a svgExport.arrowPoints pixel-matekja (dobozra normalizált). */
function arrowKnots(b) {
  const pts = [
    [0, 0.3],
    [0.6, 0.3],
    [0.6, 0.1],
    [1, 0.5],
    [0.6, 0.9],
    [0.6, 0.7],
    [0, 0.7],
  ];
  return pts.map(([x, y]) => cornerKnot(b.left + x * b.bw, b.top + y * b.bh));
}

/** vonal = vékony kitöltött doboz (a svgExport.line / rasterizáló konvenciója). */
function lineKnots(b) {
  const h = Math.max(1, b.bh);
  return [
    cornerKnot(b.left, b.top),
    cornerKnot(b.left + b.bw, b.top),
    cornerKnot(b.left + b.bw, b.top + h),
    cornerKnot(b.left, b.top + h),
  ];
}

// ── fő leképezés ─────────────────────────────────────────────────────────────

/**
 * Egy `ShapeClip`-ből ag-psd `BezierPath[]`-et épít (doc-pixelben). Visszaad
 * `null`, ha a forma nem fejezhető ki vektorként (pl. nyitott path fogók nélkül
 * 2 pont alatt) — a hívó ilyenkor raszter-fallbackre vált.
 *
 * @returns {{ paths: object[], open: boolean }|null}
 */
function shapePaths(layer, W, H) {
  const b = boxOf(layer, W, H);
  const hasSub = Array.isArray(layer.subpaths) && layer.subpaths.length > 0;
  const hasPts = Array.isArray(layer.points) && layer.points.length >= 2;

  // összetett path (boolean-művelet): több zárt al-path, fillRule szerint
  if (layer.shape === 'path' && hasSub) {
    const fillRule = layer.fillRule === 'evenodd' ? 'even-odd' : 'non-zero';
    const paths = layer.subpaths.map((pts) => ({
      open: false,
      fillRule,
      knots: pts.map((p) => knotFromPathPoint(p, b)),
    }));
    return { paths, open: false };
  }

  // egyszerű path (`points` + `closed`)
  if (layer.shape === 'path' && hasPts) {
    const open = !layer.closed;
    return {
      paths: [
        {
          open,
          fillRule: 'non-zero',
          knots: layer.points.map((p) => knotFromPathPoint(p, b)),
        },
      ],
      open,
    };
  }

  // alap-formák → zárt knot-lista
  let knots = null;
  if (layer.shape === 'rectangle') {
    knots = rectKnots(b);
  } else if (layer.shape === 'ellipse') {
    knots = ellipseKnots(b);
  } else if (layer.shape === 'star') {
    knots = starKnots(b);
  } else if (layer.shape === 'arrow') {
    knots = arrowKnots(b);
  } else if (layer.shape === 'line') {
    knots = lineKnots(b);
  }
  if (!knots || knots.length < 2) {
    return null;
  }
  return { paths: [{ open: false, fillRule: 'non-zero', knots }], open: false };
}

/**
 * Egy `ShapeClip` → ag-psd vektor-mezők (`vectorMask`/`vectorFill`/`vectorStroke`)
 * VAGY `null` (nem vektorizálható → a hívó raszterizáljon).
 *
 * - zárt forma → `vectorFill` (a `fill` szín) + opcionális `vectorStroke`
 *   (`borderColor`/`borderWidth` → px-vonal).
 * - NYITOTT path → nincs kitöltés: a `vectorStroke`-ban a `fill` szín a vonal,
 *   a `strokeWidth` (vászon-magasság %-a) a vonalvastagság (ha nincs, vékony alap).
 *
 * @param {object} layer a shape-réteg (modell)
 * @param {number} W doc-pixel szélesség
 * @param {number} H doc-pixel magasság
 * @returns {{ vectorMask:object, vectorFill?:object, vectorStroke?:object }|null}
 */
function shapeToVector(layer, W, H) {
  if (!layer || layer.kind !== 'shape') {
    return null;
  }
  const geo = shapePaths(layer, W, H);
  if (!geo) {
    return null;
  }
  const vectorMask = { paths: geo.paths };

  // vonal-vastagság: a nyitott path `strokeWidth`-je ÉS a kontúr `borderWidth`-je
  // egyaránt a vászon-MAGASSÁG %-a (a modell konvenciója); px = (%/100)*H.
  const borderPx = Number(layer.borderWidth) > 0 ? (Number(layer.borderWidth) / 100) * H : 0;
  const strokePx = Number(layer.strokeWidth) > 0 ? (Number(layer.strokeWidth) / 100) * H : 0;

  const capMap = { butt: 'butt', round: 'round', square: 'square' };
  const joinMap = { miter: 'miter', round: 'round', bevel: 'bevel' };
  const lineCapType = capMap[layer.strokeCap] || 'round';
  const lineJoinType = joinMap[layer.strokeJoin] || 'round';

  // NYITOTT path → nincs kitöltés, a vonal a `fill` színnel (a svgExport nyitott-ág
  // konvenciója). Ha nincs strokeWidth, egy látható alap-vastagság (0.9% * H).
  if (geo.open) {
    const w = strokePx > 0 ? strokePx : Math.max(1, H * 0.009);
    return {
      vectorMask,
      vectorStroke: {
        strokeEnabled: true,
        fillEnabled: false,
        lineWidth: { units: 'Pixels', value: round2(w) },
        lineCapType,
        lineJoinType,
        content: { type: 'color', color: parseColor(layer.fill) },
      },
    };
  }

  // ZÁRT forma → fill (+ opcionális kontúr)
  const out = {
    vectorMask,
    vectorFill: { type: 'color', color: parseColor(layer.fill) },
  };
  if (borderPx > 0 && layer.borderColor) {
    out.vectorStroke = {
      strokeEnabled: true,
      fillEnabled: true,
      lineWidth: { units: 'Pixels', value: round2(borderPx) },
      lineCapType,
      lineJoinType,
      content: { type: 'color', color: parseColor(layer.borderColor) },
    };
  }
  return out;
}

/** 2 tizedesre kerekít (a px-vonalvastagsághoz — determinisztikus roundtrip). */
function round2(v) {
  return Math.round(v * 100) / 100;
}

module.exports = {
  shapeToVector,
  shapePaths,
  parseColor,
  boxOf,
  knotFromPathPoint,
  cornerKnot,
  rectKnots,
  ellipseKnots,
  starKnots,
  arrowKnots,
  lineKnots,
};
