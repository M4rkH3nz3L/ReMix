import type { ImageLayer, ShapeGradient } from '@/types/project';
import { makeId } from '@/lib/id';
import { normalizeSubpaths, parseSvgPath, subpathsBounds, type Subpath } from '@/lib/vectorPath';
import { anchorBounds, bakeMatrix, boxToDoc, ellipsePath, rectPath } from './geometry';
import { apply, hasRotation, mul, parseTransform, type Mat } from './matrix';
import { clamp01, parseLen, resolveStyle, round, urlId, type Style } from './style';
import type { XmlNode } from './xml';

// ── Elem → réteg ─────────────────────────────────────────────────────────────

export interface Ctx {
  m: Mat;
  style: Style;
  grads: Record<string, ShapeGradient>;
  vb: { x: number; y: number; w: number; h: number };
}

export function readViewBox(root: XmlNode): { x: number; y: number; w: number; h: number } {
  const vbAttr = root.attrs.viewBox;
  if (vbAttr) {
    const [x, y, w, h] = vbAttr.split(/[\s,]+/).map(Number);
    if (w > 0 && h > 0) return { x, y, w, h };
  }
  const w = parseLen(root.attrs.width) || 100;
  const h = parseLen(root.attrs.height) || 100;
  return { x: 0, y: 0, w, h };
}

export function walkLayers(node: XmlNode, ctx: Ctx, out: ImageLayer[]): void {
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
    fillRule: single ? undefined : ctx.style.fillRule ?? 'nonzero',
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
    // stroke-width user-egységből a vászon MAGASSÁG %-ára (a shape-konvenció); a transzform
    // a vonalat is skálázza (a mátrix területi skálájának gyöke)
    const scale = Math.sqrt(Math.abs(ctx.m[0] * ctx.m[3] - ctx.m[1] * ctx.m[2])) || 1;
    paint.borderWidth = round((((s.strokeWidth ?? 1) * scale) / ctx.vb.h) * 100);
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
    // a zárt path a kitöltést ÉS a kontúrt is megtartja; a nyitott path egy vonal,
    // aminek a `fill` a színe és a `strokeWidth` a vastagsága (a modell konvenciója)
    if (geom.shape === 'path' && !geom.closed) {
      layer.strokeWidth = paint.borderWidth;
      delete layer.borderColor;
      delete layer.borderWidth;
      layer.fill = paint.borderColor;
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
