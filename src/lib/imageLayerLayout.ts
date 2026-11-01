import { effectiveCanvas } from '@/lib/canvasPresets';
import { alignRects, type AlignEdge, type Axis, distributeSpacing, type Rect } from '@/lib/layout';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🧲 Image Studio réteg-igazítás — a tiszta `layout` geometriát köti a réteg-
 * modellre (ADR nélkül; 07 §2.7 UI-bekötés). A rétegek KÖZÉPPEL + méretttel
 * (`position{x,y}` + `w/h`, normalizált 0–1) vannak megadva; a `layout.alignRects`
 * bal-felső + méret `Rect`-tel dolgozik — ez a réteg adapter oda-vissza.
 *
 * SZÁNDÉKOSAN pure (csak layout + típus import) → tesztelhető.
 */

/** A teljes (normalizált) vászon mint igazítási konténer. */
const CANVAS: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** egy betű átlagos szélessége a betűmérethez képest */
const TEXT_ADVANCE = 0.55;

/** A szöveg becsült mérete (a rétegnek nincs w/h-ja): a betűméret a vászon-magasság %-a. */
export function textSize(layer: Extract<ImageLayer, { kind: 'text' }>, aspect: number): { w: number; h: number } {
  const fontH = (layer.fontSize ?? 8) / 100;
  const charW = (fontH * TEXT_ADVANCE) / aspect;
  const lines = String(layer.text ?? '').split('\n');
  const leading = fontH * (layer.lineHeight ?? 1.25);
  if (layer.boxWidth) {
    const perLine = Math.max(1, Math.floor(layer.boxWidth / charW));
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    return { w: layer.boxWidth, h: rows * leading };
  }
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return { w: Math.min(0.92, longest * charW), h: lines.length * leading };
}

/**
 * A réteg befoglaló `Rect`-je (bal-felső + méret) a vászon arányában (`aspect` = W/H), a
 * forgatást is figyelembe véve. `null`, ha nincs pozíciója (fill).
 */
export function layerRect(layer: ImageLayer, aspect = 1): Rect | null {
  if (layer.kind === 'fill') {
    return null;
  }
  const p = (layer as { position?: { x: number; y: number } }).position;
  if (!p) {
    return null;
  }
  let w = (layer as { w?: number }).w ?? 0;
  let h = (layer as { h?: number }).h ?? 0;
  if (layer.kind === 'text') {
    ({ w, h } = textSize(layer, aspect));
  }
  const rotation = (layer as { rotation?: number }).rotation ?? 0;
  if (rotation) {
    // a forgatás pixel-térben értendő: a dobozt oda visszük, és ott vesszük a befoglalót
    const rad = (rotation * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const pw = w * aspect;
    [w, h] = [(pw * c + h * s) / aspect, pw * s + h * c];
  }
  return { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h };
}

/** a doc vászonaránya */
function aspectOf(doc: ImageDoc): number {
  const c = effectiveCanvas(doc);
  return c.width / c.height;
}

/** az elosztásban csak a látható, pozícionált rétegek vesznek részt */
function visiblePositioned(doc: ImageDoc): ImageLayer[] {
  return doc.layers.filter((l) => !l.hidden && layerRect(l) !== null);
}

/**
 * A réteg igazítása a VÁSZONHOZ (bal/közép/jobb · fent/közép/lent). Csak a releváns
 * tengelyt mozgatja; érdemi elmozdulás nélkül az EREDETI réteget adja vissza (no-op).
 */
export function alignLayerToCanvas(layer: ImageLayer, edge: AlignEdge, aspect = 1): ImageLayer {
  const rect = layerRect(layer, aspect);
  if (!rect) {
    return layer;
  }
  const [a] = alignRects([rect], edge, CANVAS);
  const nx = a.x + rect.width / 2;
  const ny = a.y + rect.height / 2;
  const p = (layer as { position: { x: number; y: number } }).position;
  if (Math.abs(p.x - nx) < 1e-6 && Math.abs(p.y - ny) < 1e-6) {
    return layer;
  }
  return { ...layer, position: { x: nx, y: ny } } as ImageLayer;
}

/** A megadott réteg vászonhoz-igazítása a dokumentumban (a render-cache ürítésével). */
export function alignLayerInDoc(doc: ImageDoc, layerId: string, edge: AlignEdge): ImageDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== layerId) {
      return l;
    }
    const next = alignLayerToCanvas(l, edge, aspectOf(doc));
    if (next !== l) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...doc, layers, renderedUri: undefined } : doc;
}

/** Igazítható-e a réteg (van pozíciója) — a UI gomb-engedélyezéshez. */
export function canAlignLayer(layer: ImageLayer | null): boolean {
  return !!layer && layerRect(layer) !== null;
}

/** Hány pozícionálható (igazítható/elosztható) réteg van a dokumentumban. */
export function positionedLayerCount(doc: ImageDoc): number {
  return visiblePositioned(doc).length;
}

/** A rétegek (id→Rect) visszahelyezése a dokumentumba (középpont-alapú). No-op, ha nincs érdemi mozgás. */
function applyRects(doc: ImageDoc, byId: Map<string, Rect>): ImageDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    const r = byId.get(l.id);
    if (!r) {
      return l;
    }
    const nx = r.x + r.width / 2;
    const ny = r.y + r.height / 2;
    const p = (l as { position: { x: number; y: number } }).position;
    if (Math.abs(p.x - nx) < 1e-6 && Math.abs(p.y - ny) < 1e-6) {
      return l;
    }
    changed = true;
    return { ...l, position: { x: nx, y: ny } } as ImageLayer;
  });
  return changed ? { ...doc, layers, renderedUri: undefined } : doc;
}

/**
 * 🧲 A KIJELÖLT rétegek EGYMÁSHOZ igazítása (nem a vászonhoz): a kijelölés közös
 * befoglaló dobozának éléhez/közepéhez (`layout.alignRects` konténer nélkül). A
 * kijelölés sorrendje a `layerIds`; <2 pozícionált kijelölt esetén no-op.
 */
export function alignLayersInDoc(doc: ImageDoc, layerIds: string[], edge: AlignEdge): ImageDoc {
  const ids = new Set(layerIds);
  const selected = doc.layers.filter((l) => ids.has(l.id) && layerRect(l) !== null);
  if (selected.length < 2) {
    return doc;
  }
  const aspect = aspectOf(doc);
  const aligned = alignRects(selected.map((l) => layerRect(l, aspect)!), edge);
  const byId = new Map<string, Rect>();
  selected.forEach((l, i) => byId.set(l.id, aligned[i]));
  return applyRects(doc, byId);
}

/**
 * Egyenletes RÉS-elosztás CSAK a kijelölt rétegek között (a kijelölés szélsői
 * maradnak). <3 pozícionált kijelölt esetén no-op.
 */
export function distributeSelectedInDoc(doc: ImageDoc, layerIds: string[], axis: Axis): ImageDoc {
  const ids = new Set(layerIds);
  const selected = doc.layers.filter((l) => ids.has(l.id) && layerRect(l) !== null);
  if (selected.length < 3) {
    return doc;
  }
  const aspect = aspectOf(doc);
  const distributed = distributeSpacing(selected.map((l) => layerRect(l, aspect)!), axis);
  const byId = new Map<string, Rect>();
  selected.forEach((l, i) => byId.set(l.id, distributed[i]));
  return applyRects(doc, byId);
}

/**
 * Egyenletes RÉS-elosztás az ÖSSZES pozícionált réteg között (a szélsők maradnak,
 * a köztes rések kiegyenlítődnek — `layout.distributeSpacing`). Kijelölés nélkül
 * működik; <3 pozícionált réteg esetén no-op (az eredeti doc-referencia).
 */
export function distributeLayersInDoc(doc: ImageDoc, axis: Axis): ImageDoc {
  const positioned = visiblePositioned(doc);
  if (positioned.length < 3) {
    return doc;
  }
  const aspect = aspectOf(doc);
  const distributed = distributeSpacing(positioned.map((l) => layerRect(l, aspect)!), axis);
  const byId = new Map<string, Rect>();
  positioned.forEach((l, i) => byId.set(l.id, distributed[i]));
  let changed = false;
  const layers = doc.layers.map((l) => {
    const r = byId.get(l.id);
    if (!r) {
      return l;
    }
    const nx = r.x + r.width / 2;
    const ny = r.y + r.height / 2;
    const p = (l as { position: { x: number; y: number } }).position;
    if (Math.abs(p.x - nx) < 1e-6 && Math.abs(p.y - ny) < 1e-6) {
      return l;
    }
    changed = true;
    return { ...l, position: { x: nx, y: ny } } as ImageLayer;
  });
  return changed ? { ...doc, layers, renderedUri: undefined } : doc;
}
