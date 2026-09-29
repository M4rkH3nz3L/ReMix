import type { GradientStop, ImageLayer, ShapeGradient } from '@/types/project';
import { makeId } from '@/lib/id';
import { normalizeSubpaths, parseSvgPath, subpathsBounds, type Subpath } from '@/lib/vectorPath';

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
}

// ── XML → könnyű fa ──────────────────────────────────────────────────────────

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(src: string): XmlNode | null {
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\/([a-zA-Z][\w:.-]*)\s*>|([^<]+)/g;
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [full, cdata, openTag, rawAttrs, selfClose, closeTag, textRun] = m;
    const top = stack[stack.length - 1];
    if (openTag) {
      const node: XmlNode = { tag: openTag, attrs: parseAttrs(rawAttrs ?? ''), children: [], text: '' };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    } else if (closeTag) {
      // a megnyitott elemhez tekerünk vissza (rosszul zárt XML tolerálása)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.length = i;
          break;
        }
      }
    } else if (cdata !== undefined) {
      top.text += cdata;
    } else if (textRun !== undefined && !openTag && !closeTag) {
      const t = textRun.replace(/\s+/g, ' ');
      if (t.trim()) top.text += t;
    }
    void full;
  }
  return root.children.find((c) => c.tag === 'svg') ?? root.children[0] ?? null;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// ── Affin mátrix [a,b,c,d,e,f] ───────────────────────────────────────────────

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function parseTransform(str: string | undefined): Mat {
  if (!str) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(str)) !== null) {
    const fn = t[1];
    const n = t[2].split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
    let step: Mat = IDENTITY;
    if (fn === 'matrix' && n.length === 6) step = n as Mat;
    else if (fn === 'translate') step = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (fn === 'scale') step = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const a = ((n[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const rot: Mat = [cos, sin, -sin, cos, 0, 0];
      if (n.length >= 3) {
        step = mul(mul([1, 0, 0, 1, n[1], n[2]], rot), [1, 0, 0, 1, -n[1], -n[2]]);
      } else step = rot;
    } else if (fn === 'skewX') step = [1, 0, Math.tan(((n[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') step = [1, Math.tan(((n[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, step);
  }
  return m;
}

const hasRotation = (m: Mat) => Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6;

// ── Stílus ───────────────────────────────────────────────────────────────────

interface Style {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAnchor?: string;
}

const INHERIT: (keyof Style)[] = [
  'fill',
  'stroke',
  'strokeWidth',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'textAnchor',
  'fillOpacity',
];

function resolveStyle(node: XmlNode, parent: Style): Style {
  const s: Style = {};
  for (const k of INHERIT) if (parent[k] !== undefined) (s as Record<string, unknown>)[k] = parent[k];
  const set = (key: string, val: string) => {
    const v = val.trim();
    switch (key) {
      case 'fill':
        s.fill = v;
        break;
      case 'fill-opacity':
        s.fillOpacity = parseFloat(v);
        break;
      case 'stroke':
        s.stroke = v;
        break;
      case 'stroke-width':
        s.strokeWidth = parseLen(v);
        break;
      case 'opacity':
        s.opacity = parseFloat(v);
        break;
      case 'font-size':
        s.fontSize = parseLen(v);
        break;
      case 'font-family':
        s.fontFamily = v.replace(/['"]/g, '').split(',')[0].trim();
        break;
      case 'font-weight':
        s.fontWeight = v;
        break;
      case 'text-anchor':
        s.textAnchor = v;
        break;
      default:
        break;
    }
  };
  for (const [k, v] of Object.entries(node.attrs)) set(k, v);
  // inline style felülír
  if (node.attrs.style) {
    for (const decl of node.attrs.style.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) set(decl.slice(0, i).trim(), decl.slice(i + 1));
    }
  }
  return s;
}

function parseLen(v: string): number {
  return parseFloat(String(v).replace(/px|pt|em|%/g, '')) || 0;
}

// ── Gradiensek ───────────────────────────────────────────────────────────────

function collectGradients(root: XmlNode): Record<string, ShapeGradient> {
  const raw: Record<string, XmlNode> = {};
  const walk = (n: XmlNode) => {
    if ((n.tag === 'linearGradient' || n.tag === 'radialGradient') && n.attrs.id) raw[n.attrs.id] = n;
    n.children.forEach(walk);
  };
  walk(root);
  const out: Record<string, ShapeGradient> = {};
  const stopsOf = (n: XmlNode): GradientStop[] => {
    const href = (n.attrs['xlink:href'] || n.attrs.href || '').replace('#', '');
    const src = n.children.some((c) => c.tag === 'stop') || !href ? n : raw[href] ?? n;
    return src.children
      .filter((c) => c.tag === 'stop')
      .map((c) => {
        const st = resolveStyle(c, {});
        const stopColor = c.attrs['stop-color'] || parseStyleProp(c, 'stop-color') || st.fill || '#000000';
        return { color: stopColor, at: clamp01(parseOffset(c.attrs.offset)) };
      })
      .sort((a, b) => a.at - b.at);
  };
  for (const [id, n] of Object.entries(raw)) {
    const stops = stopsOf(n);
    if (stops.length < 2) continue;
    if (n.tag === 'radialGradient') {
      out[id] = { type: 'radial', stops };
    } else {
      const x1 = parseFloat(n.attrs.x1 ?? '0');
      const y1 = parseFloat(n.attrs.y1 ?? '0');
      const x2 = parseFloat(n.attrs.x2 ?? '1');
      const y2 = parseFloat(n.attrs.y2 ?? '0');
      const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
      out[id] = { type: 'linear', angle, stops };
    }
  }
  return out;
}

function parseStyleProp(n: XmlNode, prop: string): string | undefined {
  const style = n.attrs.style;
  if (!style) return undefined;
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0 && decl.slice(0, i).trim() === prop) return decl.slice(i + 1).trim();
  }
  return undefined;
}

const parseOffset = (v: string | undefined): number => {
  if (v == null) return 0;
  return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;
const urlId = (v?: string): string | null => {
  const m = v && /url\(#([^)]+)\)/.exec(v);
  return m ? m[1] : null;
};

// ── Elem → réteg ─────────────────────────────────────────────────────────────

interface Ctx {
  m: Mat;
  style: Style;
  grads: Record<string, ShapeGradient>;
  vb: { x: number; y: number; w: number; h: number };
}

/** SVG-dokumentum → réteg-lista + doksi-méret. */
export function parseSvg(svg: string): SvgImportResult {
  const root = parseXml(svg);
  if (!root || root.tag !== 'svg') return { width: 0, height: 0, layers: [] };
  const vb = readViewBox(root);
  const grads = collectGradients(root);
  const layers: ImageLayer[] = [];
  const baseStyle: Style = { fill: '#000000' };
  walkLayers(root, { m: IDENTITY, style: baseStyle, grads, vb }, layers);
  return { width: vb.w, height: vb.h, layers };
}

function readViewBox(root: XmlNode): { x: number; y: number; w: number; h: number } {
  const vbAttr = root.attrs.viewBox;
  if (vbAttr) {
    const [x, y, w, h] = vbAttr.split(/[\s,]+/).map(Number);
    if (w > 0 && h > 0) return { x, y, w, h };
  }
  const w = parseLen(root.attrs.width) || 100;
  const h = parseLen(root.attrs.height) || 100;
  return { x: 0, y: 0, w, h };
}

function walkLayers(node: XmlNode, ctx: Ctx, out: ImageLayer[]): void {
  for (const child of node.children) {
    const m = mul(ctx.m, parseTransform(child.attrs.transform));
    const style = resolveStyle(child, ctx.style);
    const childCtx: Ctx = { ...ctx, m, style };
    if (child.tag === 'g' || child.tag === 'a' || child.tag === 'svg') {
      walkLayers(child, childCtx, out);
      continue;
    }
    if (child.tag === 'defs' || child.tag === 'linearGradient' || child.tag === 'radialGradient') continue;
    const layer = elementToLayer(child, childCtx);
    if (layer) out.push(layer);
  }
}

/** egy grafikai elem → réteg (vagy null, ha nem támogatott / üres). */
function elementToLayer(node: XmlNode, ctx: Ctx): ImageLayer | null {
  const a = node.attrs;
  if (node.tag === 'text') return textLayer(node, ctx);

  // minden formát user-térbeli al-path(ok)ra hozunk, hogy a mátrixot egységesen
  // beéghessük — a primitíveket forgatás nélkül natív alakként tartjuk meg
  let subpaths: Subpath[] | null = null;
  let primitive: { shape: 'rectangle' | 'ellipse' | 'line'; cornerRadius?: number } | null = null;

  if (node.tag === 'rect') {
    const x = parseLen(a.x);
    const y = parseLen(a.y);
    const w = parseLen(a.width);
    const h = parseLen(a.height);
    if (w <= 0 || h <= 0) return null;
    subpaths = [rectPath(x, y, w, h)];
    const rx = parseLen(a.rx || a.ry);
    primitive = { shape: 'rectangle', cornerRadius: rx > 0 ? Math.min(0.5, rx / Math.min(w, h)) : undefined };
  } else if (node.tag === 'circle' || node.tag === 'ellipse') {
    const cx = parseLen(a.cx);
    const cy = parseLen(a.cy);
    const rx = node.tag === 'circle' ? parseLen(a.r) : parseLen(a.rx);
    const ry = node.tag === 'circle' ? parseLen(a.r) : parseLen(a.ry);
    if (rx <= 0 || ry <= 0) return null;
    subpaths = [ellipsePath(cx, cy, rx, ry)];
    primitive = { shape: 'ellipse' };
  } else if (node.tag === 'line') {
    const pts = [
      { x: parseLen(a.x1), y: parseLen(a.y1) },
      { x: parseLen(a.x2), y: parseLen(a.y2) },
    ];
    subpaths = [{ points: pts, closed: false }];
    primitive = { shape: 'line' };
  } else if (node.tag === 'polyline' || node.tag === 'polygon') {
    const nums = (a.points || '').split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    if (pts.length < 2) return null;
    subpaths = [{ points: pts, closed: node.tag === 'polygon' }];
  } else if (node.tag === 'path') {
    subpaths = parseSvgPath(a.d || '');
    if (!subpaths.length) return null;
  } else {
    return null;
  }

  // a mátrix beégetése az al-path pontokba (fogókkal együtt)
  const baked = bakeMatrix(subpaths, ctx.m);
  const rotated = hasRotation(ctx.m);

  const paint = resolvePaint(ctx);

  // natív primitív, ha forgatás nincs (jobb render + cornerRadius). A doboza a
  // HORGONY-bbox (a rect/ellipse pontosan kitölti a dobozát).
  if (primitive && !rotated) {
    const box = boxToDoc(anchorBounds(baked), ctx.vb);
    return finalizeShape(node, paint, {
      shape: primitive.shape,
      position: box.center,
      w: box.w,
      h: box.h,
      cornerRadius: primitive.cornerRadius,
    });
  }

  // különben path (a saját dobozára normalizálva). A `position`/`w`/`h` a FOGÓ-
  // inkluzív dobozból, hogy a 0–1-re normalizált pontokkal illeszkedjen.
  const b = subpathsBounds(baked);
  if (!b) return null;
  const box = boxToDoc(b, ctx.vb);
  const norm = normalizeSubpaths(baked);
  const single = norm.subpaths.length === 1;
  return finalizeShape(node, paint, {
    shape: 'path',
    position: box.center,
    w: box.w,
    h: box.h,
    closed: single ? norm.subpaths[0].closed : norm.subpaths.every((s) => s.closed),
    points: single ? norm.subpaths[0].points : undefined,
    subpaths: single ? undefined : norm.subpaths.map((s) => s.points),
    fillRule: single ? undefined : 'nonzero',
  });
}

interface Paint {
  fill: string;
  gradient?: ShapeGradient;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
}

function resolvePaint(ctx: Ctx): Paint {
  const s = ctx.style;
  const fillId = urlId(s.fill);
  const gradient = fillId ? ctx.grads[fillId] : undefined;
  const fillNone = s.fill === 'none';
  const paint: Paint = {
    fill: fillNone ? 'transparent' : gradient ? '#000000' : s.fill || '#000000',
    gradient,
  };
  if (s.stroke && s.stroke !== 'none') {
    paint.borderColor = s.stroke;
    // stroke-width user-egységből a vászon MAGASSÁG %-ára (a shape-konvenció)
    paint.borderWidth = round(((s.strokeWidth ?? 1) / ctx.vb.h) * 100);
  }
  const op = (s.opacity ?? 1) * (s.fillOpacity ?? 1);
  if (op < 1) paint.opacity = round(clamp01(op));
  return paint;
}

function finalizeShape(node: XmlNode, paint: Paint, geom: Record<string, unknown>): ImageLayer {
  const layer: Record<string, unknown> = {
    id: makeId('lyr'),
    kind: 'shape',
    ...geom,
    fill: paint.fill,
  };
  if (paint.gradient) layer.gradient = paint.gradient;
  if (paint.borderColor) {
    layer.borderColor = paint.borderColor;
    layer.borderWidth = paint.borderWidth;
    if (geom.shape === 'path') {
      layer.strokeWidth = paint.borderWidth;
      delete layer.borderColor;
      delete layer.borderWidth;
      if (paint.fill === 'transparent') layer.fill = paint.borderColor;
    }
  }
  if (paint.opacity !== undefined) layer.opacity = paint.opacity;
  if (node.attrs.id) layer.name = node.attrs.id;
  return layer as unknown as ImageLayer;
}

function textLayer(node: XmlNode, ctx: Ctx): ImageLayer | null {
  const text = (node.text || node.children.map((c) => c.text).join(' ')).trim();
  if (!text) return null;
  const x = parseLen(node.attrs.x);
  const y = parseLen(node.attrs.y);
  const p = apply(ctx.m, x, y);
  const s = ctx.style;
  const scale = Math.hypot(ctx.m[0], ctx.m[1]) || 1;
  const fontPx = (s.fontSize ?? 16) * scale;
  const layer: Record<string, unknown> = {
    id: makeId('lyr'),
    kind: 'text',
    text,
    color: s.fill && s.fill !== 'none' && !urlId(s.fill) ? s.fill : '#000000',
    backgroundColor: null,
    fontSize: round(clamp01(fontPx / ctx.vb.h) * 100),
    fontWeight: /bold|[6-9]00/.test(s.fontWeight || '') ? 'bold' : 'normal',
    position: { x: round((p.x - ctx.vb.x) / ctx.vb.w), y: round((p.y - ctx.vb.y) / ctx.vb.h) },
  };
  if (s.fontFamily) layer.fontFamily = s.fontFamily;
  if (node.attrs.id) layer.name = node.attrs.id;
  return layer as unknown as ImageLayer;
}

// ── Geometria-segédek ──────────────────────────────────────────────────────

function rectPath(x: number, y: number, w: number, h: number): Subpath {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    closed: true,
  };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  // 4 köbös ív (a szokásos 0.5523 kappa-fogóaránnyal)
  const k = 0.5522847498;
  const pts = [
    { x: cx + rx, y: cy },
    { x: cx, y: cy + ry },
    { x: cx - rx, y: cy },
    { x: cx, y: cy - ry },
  ];
  const points = [
    { x: pts[0].x, y: pts[0].y, h1: { x: cx + rx, y: cy - ry * k }, h2: { x: cx + rx, y: cy + ry * k } },
    { x: pts[1].x, y: pts[1].y, h1: { x: cx + rx * k, y: cy + ry }, h2: { x: cx - rx * k, y: cy + ry } },
    { x: pts[2].x, y: pts[2].y, h1: { x: cx - rx, y: cy + ry * k }, h2: { x: cx - rx, y: cy - ry * k } },
    { x: pts[3].x, y: pts[3].y, h1: { x: cx - rx * k, y: cy - ry }, h2: { x: cx + rx * k, y: cy - ry } },
  ];
  return { points, closed: true };
}

function bakeMatrix(subpaths: Subpath[], m: Mat): Subpath[] {
  if (m === IDENTITY) return subpaths;
  return subpaths.map((s) => ({
    closed: s.closed,
    points: s.points.map((p) => {
      const a = apply(m, p.x, p.y);
      const q: { x: number; y: number; h1?: { x: number; y: number }; h2?: { x: number; y: number } } = {
        x: a.x,
        y: a.y,
      };
      if (p.h1) q.h1 = apply(m, p.h1.x, p.h1.y);
      if (p.h2) q.h2 = apply(m, p.h2.x, p.h2.y);
      return q;
    }),
  }));
}

interface Box {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/** al-path-ok HORGONY-dobozа (fogók nélkül) — a primitívek pontosan kitöltik. */
function anchorBounds(subpaths: Subpath[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of subpaths)
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, w: Math.max(1e-4, maxX - minX), h: Math.max(1e-4, maxY - minY) };
}

/** user-térbeli doboz → doksi-normalizált középpont + méret (0–1). */
function boxToDoc(
  b: Box,
  vb: { x: number; y: number; w: number; h: number }
): { center: { x: number; y: number }; w: number; h: number } {
  return {
    center: { x: round((b.minX + b.w / 2 - vb.x) / vb.w), y: round((b.minY + b.h / 2 - vb.y) / vb.h) },
    w: round(b.w / vb.w),
    h: round(b.h / vb.h),
  };
}
