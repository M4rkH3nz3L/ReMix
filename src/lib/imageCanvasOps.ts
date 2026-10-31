import { effectiveCanvas, nearestAspect } from '@/lib/canvasPresets';
import { cropImageDocRaw } from '@/lib/imageCrop';
import type { ClipMask, ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

/**
 * 🧭 Dokumentum-szintű vászon-műveletek (pure): vászonméret horgonnyal, 90°-os forgatás,
 * tükrözés. A rétegek normalizáltak, ezért minden érték, ami a vászon méretéhez vagy
 * irányához kötött, átszámolandó: pozíció, méret, betűméret, maszk, effekt, guide.
 */

type Pt = { x: number; y: number };

/** horgony 0–1: a vászon melyik pontja marad a helyén (0,0 = bal felső, .5,.5 = közép) */
export interface Anchor {
  x: number;
  y: number;
}

/** Vászon-átméretezés: a tartalom pixelre a helyén marad, csak a keret változik. */
export function resizeCanvasDoc(doc: ImageDoc, width: number, height: number, anchor: Anchor): ImageDoc {
  const c = effectiveCanvas(doc);
  const rect = {
    x: ((c.width - width) * anchor.x) / c.width,
    y: ((c.height - height) * anchor.y) / c.height,
    w: width / c.width,
    h: height / c.height,
  };
  return { ...cropImageDocRaw(doc, rect, width, height), aspectRatio: nearestAspect(width, height) };
}

/** Képméret-változtatás: a teljes kép skálázódik (a rétegek normalizáltak, azok maradnak). */
export function resampleDoc(doc: ImageDoc, width: number, height: number): ImageDoc {
  return { ...doc, width, height, aspectRatio: nearestAspect(width, height), renderedUri: undefined };
}

interface Mapping {
  point: (p: Pt) => Pt;
  /** egy pixel-vektor leképezése (árnyék-eltolás) */
  vector: (v: Pt) => Pt;
  rotation: (deg: number) => number;
  flip: { h: boolean; v: boolean };
  dir: Record<string, string>;
  guide: (g: { axis: 'x' | 'y'; pos: number }) => { axis: 'x' | 'y'; pos: number };
  gradientAngle: (deg: number) => number;
  swap: boolean;
  W: number;
  H: number;
  W2: number;
  H2: number;
}

function mapMask(mask: ClipMask, m: Mapping): ClipMask {
  const c = m.point(mask);
  const next: ClipMask = {
    ...mask,
    ...c,
    w: m.swap ? (mask.h * m.H) / m.W2 : mask.w,
    h: m.swap ? (mask.w * m.W) / m.H2 : mask.h,
  };
  if (mask.points) {
    next.points = mask.points.map(m.point);
  }
  return next;
}

function mapLayer(layer: ImageLayer, m: Mapping): ImageLayer {
  const out = { ...layer } as ImageLayer & Partial<PhotoLayer> & Record<string, unknown>;
  const src = layer as ImageLayer & Partial<PhotoLayer> & Record<string, unknown>;
  const kH = m.H / m.H2;
  const kW = m.W / m.W2;
  if (src.mask) {
    out.mask = mapMask(src.mask, m);
  }
  if (layer.kind === 'fill') {
    const gradient = layer.gradient;
    return gradient?.angle != null ? ({ ...layer, gradient: { ...gradient, angle: m.gradientAngle(gradient.angle) } } as ImageLayer) : layer;
  }
  if (layer.kind === 'adjust') {
    return out;
  }
  out.position = m.point(layer.position);
  out.rotation = m.rotation(layer.rotation ?? 0);
  if (m.flip.h) out.flipH = !layer.flipH;
  if (m.flip.v) out.flipV = !layer.flipV;
  if (layer.kind === 'text') {
    (out as unknown as { fontSize: number }).fontSize = layer.fontSize * kH;
  } else {
    out.w = layer.w * kW;
    out.h = layer.h * kH;
  }
  if (layer.kind === 'shape') {
    const s = out as unknown as typeof layer;
    if (layer.strokeWidth != null) s.strokeWidth = layer.strokeWidth * kH;
    if (layer.borderWidth != null) s.borderWidth = layer.borderWidth * kH;
    if (layer.glow) s.glow = { ...layer.glow, size: layer.glow.size * kH };
  }
  if (src.localAdjust?.mask) {
    out.localAdjust = { ...src.localAdjust, mask: mapMask(src.localAdjust.mask, m) };
  }
  if (src.maskGradient) {
    out.maskGradient = (m.dir[src.maskGradient] ?? src.maskGradient) as PhotoLayer['maskGradient'];
  }
  if (src.dropShadow) {
    const d = typeof src.dropShadow === 'object' ? src.dropShadow : {};
    const v = m.vector({ x: (d.dx ?? 0.02) * m.W, y: (d.dy ?? 0.02) * m.H });
    out.dropShadow = { ...d, dx: v.x / m.W2, dy: v.y / m.H2, blur: (d.blur ?? 0.012) * kW };
  }
  if (src.outerGlow) {
    const g = typeof src.outerGlow === 'object' ? src.outerGlow : {};
    out.outerGlow = { ...g, size: (g.size ?? 0.02) * kW };
  }
  if (src.stroke) {
    out.stroke = { ...src.stroke, width: src.stroke.width * kW };
  }
  return out;
}

function applyMapping(doc: ImageDoc, m: Mapping): ImageDoc {
  return {
    ...doc,
    width: m.W2,
    height: m.H2,
    aspectRatio: nearestAspect(m.W2, m.H2),
    layers: doc.layers.map((l) => mapLayer(l, m)),
    guides: doc.guides?.map((g) => ({ ...g, ...m.guide(g) })),
    renderedUri: undefined,
  };
}

/** A teljes vászon elforgatása 90°-kal az óramutató irányába (W és H felcserélődik). */
function rotateOnce(doc: ImageDoc): ImageDoc {
  const { width: W, height: H } = effectiveCanvas(doc);
  return applyMapping(doc, {
    W,
    H,
    W2: H,
    H2: W,
    swap: true,
    point: (p) => ({ x: 1 - p.y, y: p.x }),
    vector: (v) => ({ x: -v.y, y: v.x }),
    rotation: (deg) => deg + 90,
    flip: { h: false, v: false },
    dir: { right: 'down', down: 'left', left: 'up', up: 'right' },
    guide: (g) => (g.axis === 'x' ? { axis: 'y', pos: g.pos } : { axis: 'x', pos: 1 - g.pos }),
    gradientAngle: (deg) => deg + 90,
  });
}

/** Vászon-forgatás 90° többszöröseivel (a pozitív irány az óramutatóé). */
export function rotateCanvasDoc(doc: ImageDoc, degrees: 90 | 180 | 270 | -90): ImageDoc {
  const turns = ((degrees / 90) % 4 + 4) % 4;
  let next = doc;
  for (let i = 0; i < turns; i++) {
    next = rotateOnce(next);
  }
  return next;
}

/** Vászon-tükrözés: a forgatás előjele is fordul, a réteg saját tükrözése vált. */
export function flipCanvasDoc(doc: ImageDoc, axis: 'horizontal' | 'vertical'): ImageDoc {
  const { width: W, height: H } = effectiveCanvas(doc);
  const h = axis === 'horizontal';
  return applyMapping(doc, {
    W,
    H,
    W2: W,
    H2: H,
    swap: false,
    point: (p) => (h ? { x: 1 - p.x, y: p.y } : { x: p.x, y: 1 - p.y }),
    vector: (v) => (h ? { x: -v.x, y: v.y } : { x: v.x, y: -v.y }),
    rotation: (deg) => -deg,
    flip: { h, v: !h },
    dir: h ? { left: 'right', right: 'left' } : { up: 'down', down: 'up' },
    guide: (g) => ((g.axis === 'x') === h ? { axis: g.axis, pos: 1 - g.pos } : g),
    gradientAngle: (deg) => (h ? 180 - deg : -deg),
  });
}

/** Rétegek raszter-összevonásához a rész-dokumentum (csoport-opacitás beégetve, doc-effekt nélkül). */
export function rasterSubDoc(doc: ImageDoc, ids: string[]): ImageDoc {
  const groups = new Map((doc.groups ?? []).map((g) => [g.id, g]));
  const layers = doc.layers
    .filter((l) => ids.includes(l.id) && !(l.groupId && groups.get(l.groupId)?.hidden))
    .map((l) => ({ ...l, groupId: undefined, opacity: (l.opacity ?? 1) * (l.groupId ? groups.get(l.groupId)?.opacity ?? 1 : 1) }) as ImageLayer);
  return { ...doc, layers, groups: [], grade: undefined, adjust: undefined, vignette: 0, grain: 0, renderedUri: undefined };
}

/** A réteg és a közvetlenül alatta lévő id-ja, vagy null (nincs mivel egyesíteni / zárolt). */
export function mergeDownTargets(doc: ImageDoc, id: string): [string, string] | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i <= 0 || doc.layers[i].locked || doc.layers[i - 1].locked) {
    return null;
  }
  return [doc.layers[i - 1].id, id];
}

/** Az összevonható rétegek a lapításhoz: minden látható, nem zárolt réteg. */
export function flattenTargets(doc: ImageDoc): string[] {
  return doc.layers.filter((l) => !l.hidden && !l.locked).map((l) => l.id);
}

/** Az összevont rétegek helyére (a legalsó pozícióba) a kész teljes-vásznas kép kerül. */
export function replaceWithRaster(doc: ImageDoc, ids: string[], uri: string, id: string, name: string): ImageDoc {
  const first = doc.layers.findIndex((l) => ids.includes(l.id));
  if (first < 0) {
    return doc;
  }
  const raster: PhotoLayer = { kind: 'photo', id, name, uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' };
  const layers = doc.layers.filter((l) => !ids.includes(l.id));
  layers.splice(Math.min(first, layers.length), 0, raster);
  return { ...doc, layers, renderedUri: undefined };
}
