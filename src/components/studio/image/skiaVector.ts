import { FillType, PathOp, Skia, type SkPath, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';

import type { BooleanOp } from '@/lib/boolean';
import type { BooleanEngine, BooleanResult } from '@/lib/imageBoolean';
import { layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import { parseSvgPath } from '@/lib/vectorPath';
import type { PathPoint, ShapeLayer } from '@/types/project';

type Size = { width: number; height: number };

const SK_OP: Partial<Record<BooleanOp, PathOp>> = {
  union: PathOp.Union,
  subtract: PathOp.Difference,
  intersect: PathOp.Intersect,
  exclude: PathOp.XOR,
};

function localRings(layer: ShapeLayer): PathPoint[][] {
  if (layer.subpaths?.length) {
    return layer.subpaths;
  }
  if (layer.points?.length) {
    return [layer.points];
  }
  const points = shapeToPathPoints(layer);
  return points ? [points] : [];
}

/** A forma valódi görbékkel, a réteg helyén, forgatva és tükrözve, vászon-képpontban. */
export function layerSkPath(layer: ShapeLayer, canvas: Size): SkPath {
  const px = (p: { x: number; y: number }) => {
    const c = layerBoxToCanvas(p, layer, canvas);
    return { x: c.x * canvas.width, y: c.y * canvas.height };
  };
  const path = Skia.Path.Make();
  for (const ring of localRings(layer)) {
    if (ring.length === 0) {
      continue;
    }
    const start = px(ring[0]);
    path.moveTo(start.x, start.y);
    const n = ring.length;
    const closed = layer.closed !== false;
    for (let i = 1; i < (closed ? n + 1 : n); i++) {
      const [a, b] = [ring[i - 1], ring[i % n]];
      const to = px(b);
      if (a.h2 || b.h1) {
        const [c1, c2] = [px(a.h2 ?? a), px(b.h1 ?? b)];
        path.cubicTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
      } else {
        path.lineTo(to.x, to.y);
      }
    }
    if (closed) {
      path.close();
    }
  }
  path.setFillType(layer.fillRule === 'evenodd' ? FillType.EvenOdd : FillType.Winding);
  return path;
}

/** Skia-útvonal → a réteg-modell al-útvonalai a vászon 0–1-es terében; a görbék görbék maradnak. */
export function pathToResult(path: SkPath, canvas: Size): BooleanResult | null {
  if (path.isEmpty()) {
    return null;
  }
  const scale = (p: { x: number; y: number }) => ({ x: p.x / canvas.width, y: p.y / canvas.height });
  const subpaths = parseSvgPath(path.toSVGString())
    .filter((s) => s.points.length >= 2)
    .map((s) => s.points.map((p) => ({ ...scale(p), ...(p.h1 ? { h1: scale(p.h1) } : {}), ...(p.h2 ? { h2: scale(p.h2) } : {}) })));
  return subpaths.length ? { subpaths, fillRule: path.getFillType() === FillType.EvenOdd || path.getFillType() === FillType.InverseEvenOdd ? 'evenodd' : 'nonzero' } : null;
}

/** A logikai műveletek a két forma görbéin: homorú és lyukas formán is pontos. */
export function skiaBooleanEngine(canvas: Size): BooleanEngine {
  return (base, sel, op) => {
    const skOp = SK_OP[op];
    const result = skOp === undefined ? null : Skia.Path.MakeFromOp(layerSkPath(base, canvas), layerSkPath(sel, canvas), skOp);
    return result ? pathToResult(result, canvas) : null;
  };
}

/** Egy útvonal körvonala kitöltött formaként; a vonalvég és az illesztés a rétegé. */
export function strokeToResult(layer: ShapeLayer, canvas: Size): BooleanResult | null {
  const width = Math.max(1, Math.round(((layer.strokeWidth ?? 0.9) / 100) * canvas.height));
  const cap = { butt: StrokeCap.Butt, round: StrokeCap.Round, square: StrokeCap.Square }[layer.strokeCap ?? 'round'];
  const join = { miter: StrokeJoin.Miter, round: StrokeJoin.Round, bevel: StrokeJoin.Bevel }[layer.strokeJoin ?? 'round'];
  const out = layerSkPath(layer, canvas).stroke({ width, cap, join });
  const merged = out ? Skia.Path.MakeFromOp(out, Skia.Path.Make(), PathOp.Union) : null;
  return merged ? pathToResult(merged, canvas) : null;
}

/** Eltolt forma: a körvonal a formához adva bővít, belőle kivonva szűkít. */
export function offsetToResult(layer: ShapeLayer, canvas: Size, distance: number): BooleanResult | null {
  const base = layerSkPath(layer, canvas);
  const ring = base.copy().stroke({ width: Math.abs(distance) * 2, cap: StrokeCap.Round, join: StrokeJoin.Round });
  const merged = ring ? Skia.Path.MakeFromOp(base, ring, distance > 0 ? PathOp.Union : PathOp.Difference) : null;
  return merged ? pathToResult(merged, canvas) : null;
}

/** Az eredmény a réteg helyére kerül: vászon-terű összetett forma, a réteg stílusával. */
export function withResult(layer: ShapeLayer, result: BooleanResult): Partial<ShapeLayer> {
  return {
    shape: 'path',
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    points: undefined,
    subpaths: result.subpaths,
    fillRule: result.fillRule,
    closed: true,
    strokeWidth: undefined,
    fill: layer.fill,
  };
}
