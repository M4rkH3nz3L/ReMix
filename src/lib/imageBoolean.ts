import { booleanShapes, divideShapes, type BooleanOp } from '@/lib/boolean';
import { makeId } from '@/lib/id';
import { layerToShapeClip } from '@/lib/imageLayerClip';
import type { ImageDoc, ShapeLayer } from '@/types/project';

/**
 * 🔗 Image Studio boolean-kombináció (07 §2.6) — a `boolean` magot köti a réteg-
 * modellre. A kijelölt formát a hozzá legközelebbi MÁSIK formával kombinálja (a
 * stackben alatta; ha nincs, fölötte) — így NEM kell többszörös kijelölés. Az
 * eredmény EGY path-forma (subpaths + fillRule, vászon-térben w=h=1), amit a
 * subpaths-tudatos `ShapeOverlay` renderel (preview == video-preview).
 *
 * SZÁNDÉKOSAN pure (boolean/clip-adapter/id + típus) → tesztelhető.
 */

/** a kijelölt forma + a hozzá legközelebbi MÁSIK forma indexei (alatta előnyben). */
function findShapePair(doc: ImageDoc, selectedId: string): { baseIdx: number; selIdx: number } | null {
  const selIdx = doc.layers.findIndex((l) => l.id === selectedId && l.kind === 'shape');
  if (selIdx < 0) {
    return null;
  }
  for (let i = selIdx - 1; i >= 0; i--) {
    if (doc.layers[i].kind === 'shape') {
      return { baseIdx: i, selIdx };
    }
  }
  for (let i = selIdx + 1; i < doc.layers.length; i++) {
    if (doc.layers[i].kind === 'shape') {
      return { baseIdx: i, selIdx };
    }
  }
  return null;
}

/** Van-e a kijelölt formához MÁSIK forma, amivel kombinálható (a UI gomb-kapuhoz). */
export function canBoolean(doc: ImageDoc | null, selectedId: string | null): boolean {
  return !!doc && !!selectedId && findShapePair(doc, selectedId) !== null;
}

/**
 * A kijelölt forma boolean-kombinációja a legközelebbi másik formával. A `base` az
 * alsó forma, a `b` a kijelölt (union = base∪sel, subtract = base−sel, …). Az
 * eredmény a `base` helyére kerül, a két forrás eltűnik. `null`, ha nincs pár /
 * nincs értelmes eredmény (pl. nem metsző intersect).
 */
export function booleanCombineInDoc(
  doc: ImageDoc,
  selectedId: string,
  op: BooleanOp
): { doc: ImageDoc; resultId: string } | null {
  const pair = findShapePair(doc, selectedId);
  if (!pair) {
    return null;
  }
  const base = doc.layers[pair.baseIdx] as ShapeLayer;
  const sel = doc.layers[pair.selIdx] as ShapeLayer;
  const result = booleanShapes(layerToShapeClip(base), layerToShapeClip(sel), op);
  if (!result) {
    return null;
  }
  const id = makeId('lyr');
  const combined = {
    kind: 'shape',
    id,
    shape: 'path',
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fill: base.fill,
    subpaths: result.subpaths,
    fillRule: result.fillRule,
    closed: true,
    ...(base.opacity != null ? { opacity: base.opacity } : {}),
  } as ShapeLayer;
  const layers = doc.layers
    .map((l, i) => (i === pair.baseIdx ? combined : l))
    .filter((l) => l.id !== sel.id);
  return { doc: { ...doc, layers, renderedUri: undefined }, resultId: id };
}

/**
 * ✂️ „Divide": a kijelölt forma + a legközelebbi másik forma KÜLÖN régiókra bontása
 * (A∖B, B∖A, A∩B) — minden régió önálló réteg. A `base`-eredetű lapok a `base`
 * kitöltését, a `sel`-eredetűek a `sel` kitöltését öröklik; a lapok a `base` helyére
 * kerülnek (a két forrás eltűnik). `null`, ha nincs pár / degenerált bemenet.
 */
export function booleanDivideInDoc(
  doc: ImageDoc,
  selectedId: string
): { doc: ImageDoc; resultIds: string[] } | null {
  const pair = findShapePair(doc, selectedId);
  if (!pair) {
    return null;
  }
  const base = doc.layers[pair.baseIdx] as ShapeLayer;
  const sel = doc.layers[pair.selIdx] as ShapeLayer;
  const faces = divideShapes(layerToShapeClip(base), layerToShapeClip(sel));
  if (faces.length === 0) {
    return null;
  }
  const faceLayers: ShapeLayer[] = faces.map((f) => {
    const src = f.source === 'b' ? sel : base;
    return {
      kind: 'shape',
      id: makeId('lyr'),
      shape: 'path',
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fill: src.fill,
      subpaths: f.subpaths,
      fillRule: f.fillRule,
      closed: true,
      ...(src.opacity != null ? { opacity: src.opacity } : {}),
    } as ShapeLayer;
  });
  // a lapok a base HELYÉRE kerülnek (a base-t kivéve), a sel eltűnik
  const layers: ImageDoc['layers'] = [];
  doc.layers.forEach((l, i) => {
    if (i === pair.baseIdx) {
      layers.push(...faceLayers);
    } else if (l.id !== sel.id) {
      layers.push(l);
    }
  });
  return { doc: { ...doc, layers, renderedUri: undefined }, resultIds: faceLayers.map((l) => l.id) };
}
