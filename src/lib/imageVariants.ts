import { effectiveCanvas, nearestAspect } from '@/lib/canvasPresets';
import type { Placed } from '@/lib/imageLayerGeometry';
import { textSize } from '@/lib/imageLayerLayout';
import { followLayerMask } from '@/lib/imageSelectionOps';
import type { ImageDoc, ImageLayer, PhotoLayer, TextLayer } from '@/types/project';

/**
 * 📐 Méretváltozat egy tervből (pure) — reszponzív átméretezés (IMAGE-PROD S12 · PRO-DESIGN DS4).
 *
 * A vászon más arányú lesz, a formák nem torzulnak (egyenletes skála: a kisebbik arány, hogy a
 * tartalom elférjen). A réteg helye tengelyenként HORGONYOZVA vándorol (Figma-szerű constraints,
 * `layout.ts` mintájára): ami a bal/felső harmadban volt, az a bal/felső szélhez tapad, a jobb/alsó
 * harmadé a jobb/alsó szélhez, a középsőé a közepéhez — a margók is skálázva. Így a sarokban lévő
 * logó a sarokban marad, a középre tett cím középen. Ami egy tengelyen kitöltött (≥ 95%), az ott az
 * új vásznat is kitölti. A szöveg legfeljebb a vászon 92%-a széles (különben kisebb betű), és a
 * vásznon belül marad.
 */
const FULL_BLEED = 0.95;
const TEXT_MAX_W = 0.92;

type Size = { width: number; height: number };
type Anchor = 'start' | 'center' | 'end';

/** Mennyire nőhet egy réteg: a kisebb arány, hogy a tartalom az új vászonon is elférjen. */
function fitScale(from: Size, to: Size): number {
  return Math.min(to.width / from.width, to.height / from.height);
}

/** a horgony a réteg középpontjának helyéből (harmadok) */
export function anchorOf(center: number): Anchor {
  return center < 1 / 3 ? 'start' : center > 2 / 3 ? 'end' : 'center';
}

/**
 * egy tengely új középpontja (px): `c`, `size` a régi vászon px-ében, `newSize` a réteg új mérete;
 * a horgony a régi helyből, a margó / eltolás `s`-sel skálázva
 */
function placeAxis(c: number, size: number, oldLen: number, newLen: number, newSize: number, s: number): number {
  switch (anchorOf(c / oldLen)) {
    case 'start':
      return (c - size / 2) * s + newSize / 2;
    case 'end':
      return newLen - (oldLen - (c + size / 2)) * s - newSize / 2;
    case 'center':
      return newLen / 2 + (c - oldLen / 2) * s;
  }
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

export function adaptLayer(layer: ImageLayer, from: Size, to: Size): ImageLayer {
  if (layer.kind === 'fill' || layer.kind === 'adjust') {
    return layer;
  }
  const s = fitScale(from, to);
  const { x, y } = layer.position;
  const [cx, cy] = [x * from.width, y * from.height];

  if (layer.kind === 'text') {
    const fromAspect = from.width / from.height;
    const toAspect = to.width / to.height;
    // a betűméret képpontban arányos (a vászon-magasság %-a → vissza kell számolni)
    let fontSize = ((layer.fontSize ?? 8) * s * from.height) / to.height;
    const boxWidth = layer.boxWidth ? Math.min(TEXT_MAX_W, (layer.boxWidth * from.width * s) / to.width) : undefined;
    const old = textSize(layer, fromAspect);
    let next: TextLayer = { ...layer, fontSize, ...(boxWidth ? { boxWidth } : {}) };
    // a szöveg nem lehet szélesebb a vászon 92%-ánál (doboz nélkül a sor hossza számít)
    const nw = textSize(next, toAspect).w;
    if (!boxWidth && nw >= TEXT_MAX_W - 1e-6) {
      const longest = Math.max(...String(layer.text ?? '').split('\n').map((l) => l.length), 1);
      const fits = (TEXT_MAX_W * 100 * toAspect) / (longest * 0.55);
      fontSize = Math.min(fontSize, fits);
      next = { ...next, fontSize };
    }
    const size = textSize(next, toAspect);
    const [w, h] = [size.w * to.width, size.h * to.height];
    const nx = placeAxis(cx, old.w * from.width, from.width, to.width, w, s);
    const ny = placeAxis(cy, old.h * from.height, from.height, to.height, h, s);
    return { ...next, position: { x: clamp(nx, w / 2, to.width - w / 2) / to.width, y: clamp(ny, h / 2, to.height - h / 2) / to.height } };
  }

  const { w, h } = layer;
  const fullW = w >= FULL_BLEED;
  const fullH = h >= FULL_BLEED;
  if (fullW && fullH) {
    return layer;
  }
  const [pw, ph] = [w * from.width, h * from.height];
  // a kitöltő tengely az új vásznat is kitölti (a másik tengely egyenletes skálán)
  const nw = fullW ? to.width * w : pw * s;
  const nh = fullH ? to.height * h : ph * s;
  const nx = fullW ? to.width / 2 : placeAxis(cx, pw, from.width, to.width, nw, s);
  const ny = fullH ? to.height / 2 : placeAxis(cy, ph, from.height, to.height, nh, s);
  return { ...layer, w: nw / to.width, h: nh / to.height, position: { x: nx / to.width, y: ny / to.height } } as ImageLayer;
}

/** a réteg maszkjai az új lapon is a rétegen ugyanott (S15): a régi réteg terén át az új helyre */
function withMasks(layer: ImageLayer, next: ImageLayer, from: Size, to: Size): ImageLayer {
  const { mask, localAdjust } = layer as PhotoLayer;
  if ((!mask && !localAdjust?.mask) || !('position' in layer) || !layer.position) return next;
  const a = layer as unknown as Placed;
  const b = next as unknown as Placed;
  return {
    ...next,
    ...(mask ? { mask: followLayerMask(mask, a, b, from, to) } : {}),
    ...(localAdjust?.mask ? { localAdjust: { ...localAdjust, mask: followLayerMask(localAdjust.mask, a, b, from, to) } } : {}),
  } as ImageLayer;
}

/** Új lap a megadott méretben, saját azonosítókkal: az eredeti érintetlen marad. */
export function variantDoc(doc: ImageDoc, width: number, height: number, name: string, makeId: () => string): ImageDoc {
  const from = effectiveCanvas(doc);
  const to = { width, height };
  return {
    ...doc,
    id: makeId(),
    name,
    width,
    height,
    aspectRatio: nearestAspect(width, height),
    renderedUri: undefined,
    renderedKey: undefined,
    thumbUri: undefined,
    thumbKey: undefined,
    guides: undefined,
    layers: doc.layers.map((l) => ({ ...withMasks(l, adaptLayer(l, from, to), from, to), id: makeId() })),
  };
}
