import { effectiveCanvas } from '@/lib/canvasPresets';
import { layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import type { ClipMask, ImageDoc, ImageLayer, PathPoint, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

/**
 * ✂️ Vágómaszk (IMAGE-PROD S18) — pure. A `clipTo`-s fotó a hivatkozott forma alakján belül látszik.
 * A render előtt ez a lépés a forma körvonalát (forgatva, tükrözve, lekerekített sarokkal, görbével)
 * vászon-poligonná alakítja, és a fotó maszkjává teszi (a saját maszkjával metszve). Ugyanezt kapja a
 * vászon, a telefonos render és a szerver — a maszk útja már mért, így a paritás szerkezetből adódik.
 * Szöveg- és fotó-alapra (betű- / alfa-alak) nem működik: ott a hivatkozás hatástalan.
 */

type Pt = { x: number; y: number };

/** egy zárt Bézier-gyűrű sűrű poligonként (szakaszonként `steps` pont) */
export function flattenRing(points: PathPoint[], steps = 12): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    if (!a.h2 && !b.h1) continue;
    const c1 = a.h2 ?? a;
    const c2 = b.h1 ?? b;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      });
    }
  }
  return out;
}

/** a forma körvonal-gyűrűi vászon-koordinátában (0–1), vagy null, ha nincs zárt alakja */
export function shapeOutlineOnCanvas(shape: ShapeLayer, canvas: { width: number; height: number }): Pt[][] | null {
  let rings: PathPoint[][] | null = null;
  if (shape.shape === 'path') {
    if (shape.subpaths?.length) rings = shape.subpaths;
    else if (shape.closed && (shape.points?.length ?? 0) >= 3) rings = [shape.points!];
  } else {
    const aspect = (shape.w * canvas.width) / Math.max(1e-6, shape.h * canvas.height);
    const pts = shapeToPathPoints(shape, aspect);
    if (pts) rings = [pts];
  }
  if (!rings) return null;
  return rings.map((r) => flattenRing(r).map((p) => layerBoxToCanvas(p, shape, canvas)));
}

function bbox(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** a fotó meglévő maszkja műveletként (paraméteres alak → körvonal), vagy null, ha nem írható le így */
function maskOps(mask: ClipMask): { op: 'add' | 'subtract' | 'intersect'; points: Pt[] }[] | null {
  if (mask.image) return null;
  if (mask.ops?.length) return mask.ops;
  if (mask.shape === 'polygon' && (mask.points?.length ?? 0) >= 3) return [{ op: 'add', points: mask.points! }];
  const [rx, ry] = [mask.w / 2, mask.h / 2];
  const ring =
    mask.shape === 'ellipse'
      ? Array.from({ length: 48 }, (_, i) => ({ x: mask.x + rx * Math.cos((i / 48) * Math.PI * 2), y: mask.y + ry * Math.sin((i / 48) * Math.PI * 2) }))
      : [{ x: mask.x - rx, y: mask.y - ry }, { x: mask.x + rx, y: mask.y - ry }, { x: mask.x + rx, y: mask.y + ry }, { x: mask.x - rx, y: mask.y + ry }];
  return [{ op: 'add', points: ring }];
}

/** a vágás maszkja: a forma gyűrűi (több alútnál egyesítve), a saját maszkkal metszve */
export function clipMaskFor(photo: PhotoLayer, shape: ShapeLayer, canvas: { width: number; height: number }): ClipMask | null {
  const rings = shapeOutlineOnCanvas(shape, canvas);
  if (!rings?.length) return null;
  const own = photo.mask ? maskOps(photo.mask) : [];
  if (own === null) return null; // festett maszk mellett a vágás nem képezhető (dokumentált korlát)
  const all = rings.flat();
  let ops: { op: 'add' | 'subtract' | 'intersect'; points: Pt[] }[];
  if (own.length === 0) {
    ops = rings.map((points) => ({ op: 'add' as const, points }));
  } else if (rings.length === 1) {
    ops = [...own, { op: 'intersect', points: rings[0] }];
  } else {
    return null; // többrészes forma + saját maszk: nem írható le egy műveletsorral
  }
  return {
    shape: 'polygon',
    ...bbox(all),
    points: rings[0],
    ops,
    feather: photo.mask?.feather ?? 0,
    invert: photo.mask?.invert,
  };
}

// ── ✂️🔤 vágás SZÖVEGBE: a betűk alakja festett maszkként (a telefon rendereli, élő kulccsal) ──

/** a szöveg-maszk tartalmi kulcsa: minden, ami a betűk alakját és helyét adja (a szín, az átlátszóság nem) */
export function textMaskKey(text: TextLayer, canvas: { width: number; height: number }): string {
  const { id: _id, name: _n, color: _c, opacity: _o, blendMode: _b, hidden: _h, locked: _l, groupId: _g, textStyle, ...shape } = text as TextLayer & { name?: string; groupId?: string; locked?: boolean };
  const stroke = textStyle?.stroke ? { w: textStyle.stroke.width } : null;
  const raw = JSON.stringify({ shape, stroke, w: canvas.width, h: canvas.height });
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${raw.length.toString(36)}${h.toString(36)}`;
}

/** a maszk-render rész-dokumentuma: fekete alapon a szöveg fehéren, effektek (árnyék, ragyogás, háttér) nélkül */
export function textMaskSubDoc(doc: ImageDoc, text: TextLayer): ImageDoc {
  const white: TextLayer = {
    ...text,
    color: '#ffffff',
    opacity: 1,
    hidden: false,
    blendMode: undefined,
    groupId: undefined,
    backgroundColor: null,
    stylePreset: 'plain',
    dropShadow: undefined,
    outerGlow: undefined,
    textStyle: text.textStyle?.stroke ? { stroke: { ...text.textStyle.stroke, color: '#ffffff' } } : undefined,
  } as TextLayer;
  return { ...doc, layers: [{ id: 'mask_bg', kind: 'fill', fill: '#000000' } as ImageLayer, white], groups: [], grade: undefined, adjust: undefined, vignette: 0, grain: 0, renderedUri: undefined };
}

/** a szöveg-alapú vágások kulcsai (a még hiányzó maszkok rendereléséhez) */
export function textClipBases(doc: ImageDoc): { key: string; text: TextLayer }[] {
  const canvas = effectiveCanvas(doc);
  const out = new Map<string, TextLayer>();
  for (const l of doc.layers) {
    if (l.kind !== 'photo' || !l.clipTo) continue;
    const base = doc.layers.find((x) => x.id === l.clipTo);
    if (base?.kind === 'text' && !base.hidden) out.set(textMaskKey(base, canvas), base);
  }
  return [...out].map(([key, text]) => ({ key, text }));
}

/**
 * a vágómaszkok feloldása a render előtt: a `clipTo`-s fotó maszkot kap (a dokumentum nem változik).
 * Szöveg-alapnál a `textMasks` (kulcs → a betűk maszk-képe) adja; ha még nincs meg, a fotó vágatlan marad.
 */
export function resolveClipMasks(doc: ImageDoc, textMasks?: ReadonlyMap<string, string>): ImageDoc {
  if (!doc.layers.some((l) => l.kind === 'photo' && l.clipTo)) return doc;
  const canvas = effectiveCanvas(doc);
  const layers = doc.layers.map((l): ImageLayer => {
    if (l.kind !== 'photo' || !l.clipTo) return l;
    const base = doc.layers.find((x) => x.id === l.clipTo);
    if (!base || base.hidden) return l;
    if (base.kind === 'text') {
      const uri = textMasks?.get(textMaskKey(base, canvas));
      // a festett maszk nem metszhető a saját maszkkal → saját maszk mellett a vágás nem képezhető (korlát)
      return uri && !l.mask ? ({ ...l, mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: uri } } as ImageLayer) : l;
    }
    if (base.kind !== 'shape') return l;
    const mask = clipMaskFor(l, base, canvas);
    return mask ? { ...l, mask } : l;
  });
  return { ...doc, layers };
}

/** a fotó alatti legközelebbi forma vagy szöveg (a vágómaszk alapja), vagy null */
export function clipBaseBelow(doc: ImageDoc, photoId: string): ShapeLayer | TextLayer | null {
  const i = doc.layers.findIndex((l) => l.id === photoId);
  for (let k = i - 1; k >= 0; k--) {
    const l = doc.layers[k];
    if (l.kind === 'text') return l;
    if (l.kind === 'shape' && l.shape !== 'line' && !(l.shape === 'path' && !l.closed && !l.subpaths?.length)) return l;
  }
  return null;
}
