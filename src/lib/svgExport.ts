// 🧩 Kép-dokumentum → SVG (vektor-export) — az [svgImport](./svgImport.ts) PÁRJA.
//
// A réteg-fából szabványos `<svg>`-t emittál, hogy a VEKTOR-doc VEKTORKÉNT
// exportálódjon (nem raszter-PNG-be égetve). A koordináta-konvenció a projekté:
// a réteg `position` a KÖZÉPPONT (0–1), `w`/`h` a vászonra normalizált, a
// forma-`points`/`subpaths` a forma SAJÁT dobozára (0–1) normalizáltak, a
// `borderWidth` a vászon-MAGASSÁG %-a — pontosan úgy, ahogy a worker-rasterizáló
// ([server/text-render.js](../../server/text-render.js)) értelmezi, hogy az SVG
// vizuálisan EGYEZZEN a rasztertel (Preview == Export == SVG).
//
// Nem minden raszter-effekt fejezhető ki tiszta SVG-ben: a fotó-`adjust`/`filter`
// kimarad (a `<image>` a nyers kép), a konikus gradient az első stop színére esik
// vissza — ezeket a hívó tudja (a doc.format==='vector' alapvetően vektor-elemű).

import type {
  GradientStop,
  ImageDoc,
  ImageLayer,
  PathPoint,
  ShapeGradient,
  ShapeLayer,
} from '@/types/project';
import { subpathsToSvgPath, type Subpath } from './vectorPath';

export interface SvgExportOptions {
  /** a kimenet pixel-mérete; hiányzó = a doc width/height, vagy az arányból 1080 alapon */
  width?: number;
  height?: number;
}

// ── apró segédek ──────────────────────────────────────────────────────────────

/** XML-escape (szöveg + attribútum-érték) */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** rövid, determinisztikus szám (max 2 tizedes, nincs -0) */
function n(v: number): string {
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/** a vászon pixel-mérete a doc-ból vagy az arányból */
function canvas(doc: ImageDoc, opts?: SvgExportOptions): { W: number; H: number } {
  if (opts?.width && opts?.height) {
    return { W: opts.width, H: opts.height };
  }
  if (doc.width && doc.height) {
    return { W: doc.width, H: doc.height };
  }
  const [aw, ah] = String(doc.aspectRatio || '9:16')
    .split(':')
    .map((x) => Number(x) || 1);
  const base = 1080;
  return aw >= ah
    ? { W: Math.round((base * aw) / ah), H: base }
    : { W: base, H: Math.round((base * ah) / aw) };
}

interface Box {
  bw: number;
  bh: number;
  cx: number;
  cy: number;
  left: number;
  top: number;
}

function boxOf(layer: { position?: { x: number; y: number }; w?: number; h?: number }, W: number, H: number): Box {
  const bw = (layer.w ?? 1) * W;
  const bh = (layer.h ?? 1) * H;
  const cx = (layer.position?.x ?? 0.5) * W;
  const cy = (layer.position?.y ?? 0.5) * H;
  return { bw, bh, cx, cy, left: cx - bw / 2, top: cy - bh / 2 };
}

/** forgatás + tükrözés a KÖZÉPPONT körül (a rasterizáló helyi-tér sorrendje) */
function transformOf(layer: { rotation?: number; flipH?: boolean; flipV?: boolean }, b: Box): string {
  const sx = layer.flipH ? -1 : 1;
  const sy = layer.flipV ? -1 : 1;
  const parts: string[] = [];
  if (layer.rotation || sx !== 1 || sy !== 1) {
    parts.push(`translate(${n(b.cx)} ${n(b.cy)})`);
    if (layer.rotation) {
      parts.push(`rotate(${n(layer.rotation)})`);
    }
    if (sx !== 1 || sy !== 1) {
      parts.push(`scale(${sx} ${sy})`);
    }
    parts.push(`translate(${n(-b.cx)} ${n(-b.cy)})`);
  }
  return parts.join(' ');
}

/** a forma-doboz 0–1 pontját abszolút px-be (a fogókkal együtt) */
function mapPt(p: PathPoint, b: Box): PathPoint {
  const map = (q?: { x: number; y: number }) =>
    q ? { x: b.left + q.x * b.bw, y: b.top + q.y * b.bh } : undefined;
  return { x: b.left + p.x * b.bw, y: b.top + p.y * b.bh, h1: map(p.h1), h2: map(p.h2) };
}

// ── gradient / pattern defs ─────────────────────────────────────────────────

function stopsSvg(stops: GradientStop[]): string {
  return stops
    .map((s) => `<stop offset="${n(Math.max(0, Math.min(1, s.at)))}" stop-color="${esc(s.color)}"/>`)
    .join('');
}

/** lineáris/radiális gradient-def; konikus → nincs natív SVG (a hívó az első stopra esik vissza) */
function gradientDef(g: ShapeGradient, id: string): string | null {
  if (g.type === 'radial') {
    return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stopsSvg(g.stops)}</radialGradient>`;
  }
  if (g.type === 'linear') {
    const angle = ((g.angle ?? 0) * Math.PI) / 180;
    // a dobozra normalizált (objectBoundingBox) irányvektor a szögből — a CSS
    // `linear-gradient(θ)` konvenciójával (0°=fel, óramutató szerint nő), hogy az
    // SVG a raszterrel (text-render cssGradient) EGYEZZEN: a vektor (sinθ, −cosθ)
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const x1 = 0.5 - dx / 2;
    const y1 = 0.5 - dy / 2;
    const x2 = 0.5 + dx / 2;
    const y2 = 0.5 + dy / 2;
    return `<linearGradient id="${id}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stopsSvg(g.stops)}</linearGradient>`;
  }
  return null; // conic
}

interface PatternSpec {
  preset: 'dots' | 'grid' | 'stripes' | 'checker';
  fg: string;
  bg?: string;
  size: number;
  rotation?: number;
  opacity?: number;
}

/** `<pattern>` def a worker patternTileJs-ét tükrözve (tile = size% × boxH) */
function patternDef(p: PatternSpec, id: string, boxH: number): string {
  const tile = Math.max(4, (p.size / 100) * boxH);
  const t = (v: number) => n(v);
  const half = tile / 2;
  const sw = Math.max(1, tile * 0.12);
  let prims = '';
  if (p.preset === 'dots') {
    prims = `<circle cx="${t(half)}" cy="${t(half)}" r="${t(tile * 0.22)}" fill="${esc(p.fg)}"/>`;
  } else if (p.preset === 'grid') {
    prims =
      `<line x1="0" y1="0" x2="${t(tile)}" y2="0" stroke="${esc(p.fg)}" stroke-width="${t(sw)}"/>` +
      `<line x1="0" y1="0" x2="0" y2="${t(tile)}" stroke="${esc(p.fg)}" stroke-width="${t(sw)}"/>`;
  } else if (p.preset === 'stripes') {
    prims = `<rect x="0" y="0" width="${t(half)}" height="${t(tile)}" fill="${esc(p.fg)}"/>`;
  } else {
    // checker
    prims =
      `<rect x="0" y="0" width="${t(half)}" height="${t(half)}" fill="${esc(p.fg)}"/>` +
      `<rect x="${t(half)}" y="${t(half)}" width="${t(half)}" height="${t(half)}" fill="${esc(p.fg)}"/>`;
  }
  const bg = p.bg ? `<rect x="0" y="0" width="${t(tile)}" height="${t(tile)}" fill="${esc(p.bg)}"/>` : '';
  const rot = p.rotation ? ` patternTransform="rotate(${n(p.rotation)} ${t(half)} ${t(half)})"` : '';
  const op = p.opacity != null && p.opacity < 1 ? ` opacity="${n(p.opacity)}"` : '';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${t(tile)}" height="${t(tile)}"${rot}${op}>${bg}${prims}</pattern>`;
}

// ── forma-geometriák (star/arrow) ────────────────────────────────────────────

function starPoints(b: Box): string {
  const R = Math.min(b.bw, b.bh) / 2;
  const r = R * 0.5;
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? R : r;
    const ang = (-90 + k * 36) * (Math.PI / 180);
    pts.push(`${n(b.cx + rad * Math.cos(ang))},${n(b.cy + rad * Math.sin(ang))}`);
  }
  return pts.join(' ');
}

function arrowPoints(b: Box): string {
  const pts: [number, number][] = [
    [0, 0.3],
    [0.6, 0.3],
    [0.6, 0.1],
    [1, 0.5],
    [0.6, 0.9],
    [0.6, 0.7],
    [0, 0.7],
  ];
  return pts.map(([x, y]) => `${n(b.left + x * b.bw)},${n(b.top + y * b.bh)}`).join(' ');
}

// ── réteg-emitterek ──────────────────────────────────────────────────────────

/** a kitöltés-attribútum + a hozzá tartozó def (gradient/pattern/szín) */
function paintOf(
  layer: Pick<ShapeLayer, 'fill' | 'gradient' | 'pattern'> & { fillGradient?: { from: string; to: string } },
  id: string,
  box: Box,
  defs: string[],
): string {
  if (layer.gradient) {
    const def = gradientDef(layer.gradient, id);
    if (def) {
      defs.push(def);
      return `url(#${id})`;
    }
    // konikus → első stop
    return esc(layer.gradient.stops[0]?.color ?? layer.fill ?? '#000000');
  }
  if (layer.fillGradient) {
    defs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(
        layer.fillGradient.from,
      )}"/><stop offset="1" stop-color="${esc(layer.fillGradient.to)}"/></linearGradient>`,
    );
    return `url(#${id})`;
  }
  if (layer.pattern) {
    defs.push(patternDef(layer.pattern as PatternSpec, id, box.bh));
    return `url(#${id})`;
  }
  return esc(layer.fill ?? '#000000');
}

function shapeSvg(layer: ShapeLayer, i: number, W: number, H: number, defs: string[]): string {
  const b = boxOf(layer, W, H);
  const paint = paintOf(layer, `g${i}`, b, defs);
  const strokeW = ((layer.borderWidth ?? 0) / 100) * H;
  const stroke =
    layer.borderColor && strokeW > 0
      ? ` stroke="${esc(layer.borderColor)}" stroke-width="${n(strokeW)}"`
      : '';
  const hasSub = Array.isArray(layer.subpaths) && layer.subpaths.length > 0;
  const hasPts = Array.isArray(layer.points) && layer.points.length >= 2;

  let el = '';
  if (layer.shape === 'rectangle') {
    const rx = layer.cornerRadius ? n(layer.cornerRadius * Math.min(b.bw, b.bh)) : null;
    el = `<rect x="${n(b.left)}" y="${n(b.top)}" width="${n(b.bw)}" height="${n(b.bh)}"${rx ? ` rx="${rx}"` : ''} fill="${paint}"${stroke}/>`;
  } else if (layer.shape === 'ellipse') {
    el = `<ellipse cx="${n(b.cx)}" cy="${n(b.cy)}" rx="${n(b.bw / 2)}" ry="${n(b.bh / 2)}" fill="${paint}"${stroke}/>`;
  } else if (layer.shape === 'line') {
    // vonal = vékony kitöltött doboz (a rasterizáló is így rajzolja)
    el = `<rect x="${n(b.left)}" y="${n(b.top)}" width="${n(b.bw)}" height="${n(Math.max(1, b.bh))}" fill="${paint}"/>`;
  } else if (layer.shape === 'star') {
    el = `<polygon points="${starPoints(b)}" fill="${paint}"${stroke}/>`;
  } else if (layer.shape === 'arrow') {
    el = `<polygon points="${arrowPoints(b)}" fill="${paint}"${stroke}/>`;
  } else if (layer.shape === 'path' && (hasSub || hasPts)) {
    const subs: Subpath[] = hasSub
      ? (layer.subpaths as PathPoint[][]).map((pts) => ({ points: pts.map((p) => mapPt(p, b)), closed: true }))
      : [{ points: (layer.points as PathPoint[]).map((p) => mapPt(p, b)), closed: Boolean(layer.closed) }];
    const d = subpathsToSvgPath(subs);
    const closed = hasSub || Boolean(layer.closed);
    if (closed) {
      const fr = hasSub ? ` fill-rule="${layer.fillRule || 'nonzero'}"` : '';
      el = `<path d="${d}" fill="${paint}"${fr}${stroke}/>`;
    } else {
      // nyitott path = vonal a `fill` színével
      el = `<path d="${d}" fill="none" stroke="${esc(layer.fill ?? '#000000')}" stroke-width="${n(Math.max(1, strokeW || H * 0.009))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  } else {
    return '';
  }

  // árnyék / ragyogás → SVG szűrő (a sziluetten)
  let filterId = '';
  if (layer.shadow || layer.glow) {
    filterId = `fx${i}`;
    const blur = layer.glow ? ((layer.glow.size ?? 6) / 100) * H : H * 0.01;
    const glowColor = layer.glow?.color ?? layer.fill ?? '#000000';
    const parts: string[] = [];
    if (layer.glow) {
      parts.push(
        `<feDropShadow dx="0" dy="0" stdDeviation="${n(blur)}" flood-color="${esc(glowColor)}" flood-opacity="0.9"/>`,
      );
    }
    if (layer.shadow) {
      parts.push(
        `<feDropShadow dx="0" dy="${n(H * 0.01)}" stdDeviation="${n(H * 0.012)}" flood-color="#000000" flood-opacity="0.45"/>`,
      );
    }
    defs.push(`<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}</filter>`);
  }

  return wrap(el, layer, b, filterId);
}

function photoSvg(layer: Extract<ImageLayer, { kind: 'photo' }>, W: number, H: number): string {
  const b = boxOf(layer, W, H);
  const par = layer.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
  const el = `<image href="${esc(layer.uri)}" x="${n(b.left)}" y="${n(b.top)}" width="${n(b.bw)}" height="${n(b.bh)}" preserveAspectRatio="${par}"/>`;
  return wrap(el, layer, b, '');
}

function fillSvg(layer: Extract<ImageLayer, { kind: 'fill' }>, i: number, W: number, H: number, defs: string[]): string {
  const b: Box = { bw: W, bh: H, cx: W / 2, cy: H / 2, left: 0, top: 0 };
  const paint = paintOf(layer, `g${i}`, b, defs);
  return `<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="${paint}"/>`;
}

function textSvg(layer: Extract<ImageLayer, { kind: 'text' }>, W: number, H: number): string {
  const b = boxOf(layer, W, H);
  const fontPx = ((layer.fontSize ?? 8) / 100) * H;
  const family = layer.fontFamily ? esc(layer.fontFamily) : 'sans-serif';
  const weight = layer.fontWeight === 'bold' ? 'bold' : 'normal';
  const ls = layer.letterSpacing ? ` letter-spacing="${n(layer.letterSpacing)}"` : '';
  const el =
    `<text x="${n(b.cx)}" y="${n(b.cy)}" font-family="${family}" font-size="${n(fontPx)}" font-weight="${weight}"` +
    ` fill="${esc(layer.color ?? '#ffffff')}" text-anchor="middle" dominant-baseline="central"${ls}>${esc(layer.text ?? '')}</text>`;
  return wrap(el, layer, b, '');
}

/** forgatás/tükrözés + opacity + blend-mód csomagolás (ha kell) */
function wrap(
  el: string,
  layer: { rotation?: number; flipH?: boolean; flipV?: boolean; opacity?: number; blendMode?: string },
  b: Box,
  filterId: string,
): string {
  const tf = transformOf(layer, b);
  const op = layer.opacity != null && layer.opacity < 1 ? ` opacity="${n(layer.opacity)}"` : '';
  const blend = layer.blendMode && layer.blendMode !== 'normal' ? ` style="mix-blend-mode:${esc(layer.blendMode)}"` : '';
  const filt = filterId ? ` filter="url(#${filterId})"` : '';
  if (!tf && !op && !blend && !filt) {
    return el;
  }
  return `<g${tf ? ` transform="${tf}"` : ''}${op}${blend}${filt}>${el}</g>`;
}

function isVisible(layer: ImageLayer & { visible?: boolean }): boolean {
  return layer.visible !== false;
}

/**
 * 🧩 A kép-dokumentum teljes SVG-reprezentációja (export-string). A rétegeket
 * RAJZOLÁSI SORRENDBEN emittálja (az első réteg hátul), a gradient/pattern/szűrő
 * defineket a `<defs>`-be gyűjti.
 */
export function imageDocToSvg(doc: ImageDoc, opts?: SvgExportOptions): string {
  const { W, H } = canvas(doc, opts);
  const defs: string[] = [];
  const body: string[] = [];
  const layers = (doc.layers ?? []).filter(isVisible);
  layers.forEach((layer, i) => {
    if (layer.kind === 'fill') {
      body.push(fillSvg(layer, i, W, H, defs));
    } else if (layer.kind === 'photo') {
      body.push(photoSvg(layer, W, H));
    } else if (layer.kind === 'shape') {
      body.push(shapeSvg(layer, i, W, H, defs));
    } else if (layer.kind === 'text') {
      body.push(textSvg(layer, W, H));
    }
  });
  const defsBlock = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}" height="${n(H)}" viewBox="0 0 ${n(W)} ${n(H)}">` +
    defsBlock +
    body.filter(Boolean).join('') +
    `</svg>`
  );
}
