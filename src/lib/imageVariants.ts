import { effectiveCanvas, nearestAspect } from '@/lib/canvasPresets';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * 📐 Méretváltozat egy tervből (pure): a vászon más arányú lesz, a formák nem torzulnak. A rétegek
 * középpontja arányosan vándorol, a méretük egyenletes skálán változik; ami a teljes vásznat
 * kitöltötte, az az új vásznat is kitölti. A szöveg a vászon-magasság százalékában van, ezért azt
 * vissza kell számolni, különben a keskeny formátumon más méretű lenne.
 */
const FULL_BLEED = 0.95;

/** Mennyire nőhet egy réteg: a kisebb arány, hogy a tartalom az új vászonon is elférjen. */
function fitScale(from: { width: number; height: number }, to: { width: number; height: number }): number {
  return Math.min(to.width / from.width, to.height / from.height);
}

export function adaptLayer(layer: ImageLayer, from: { width: number; height: number }, to: { width: number; height: number }): ImageLayer {
  if (layer.kind === 'fill' || layer.kind === 'adjust') {
    return layer;
  }
  const s = fitScale(from, to);
  if (layer.kind === 'text') {
    return { ...layer, fontSize: ((layer.fontSize ?? 8) * s * from.height) / to.height };
  }
  const { w, h } = layer;
  if (w >= FULL_BLEED && h >= FULL_BLEED) {
    return layer;
  }
  return { ...layer, w: (w * from.width * s) / to.width, h: (h * from.height * s) / to.height };
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
    guides: undefined,
    layers: doc.layers.map((l) => ({ ...adaptLayer(l, from, to), id: makeId() })),
  };
}
