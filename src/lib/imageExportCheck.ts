import { deleteSelection } from '@/lib/imageSelectionOps';
import { selectionToMask, type Selection } from '@/lib/selection';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * ✅ Export-minőségkapu és rész-exportok (pure). A kész fájlt visszaolvassuk: megnyitható-e, a kért
 * méretű-e, megmaradt-e az átlátszóság. A hiba nem marad csendben, a felhasználó látja, mi a baj.
 */
export interface ExportFacts {
  /** dekódolható-e a fájl */
  opened: boolean;
  width: number;
  height: number;
  bytes: number;
  /** van-e átlátszó képpont */
  hasAlpha: boolean;
}

export interface ExportExpect {
  width: number;
  height: number;
  format: 'png' | 'jpg' | 'webp';
  /** a dokumentumnak nincs takaró háttere, a formátum tud alfát */
  wantsAlpha: boolean;
}

export type ExportProblem = 'unreadable' | 'empty' | 'size' | 'alpha';

/** ±2 képpont: a szerver páros méretre kerekít. */
const SIZE_SLACK = 2;

export function exportProblems(facts: ExportFacts, expect: ExportExpect): ExportProblem[] {
  if (!facts.opened) {
    return ['unreadable'];
  }
  const out: ExportProblem[] = [];
  if (facts.bytes <= 0) {
    out.push('empty');
  }
  if (Math.abs(facts.width - expect.width) > SIZE_SLACK || Math.abs(facts.height - expect.height) > SIZE_SLACK) {
    out.push('size');
  }
  if (expect.wantsAlpha && !facts.hasAlpha) {
    out.push('alpha');
  }
  return out;
}

/** Kell-e átlátszóságnak maradnia? Teljes, fedő háttér nélkül, alfát tudó formátumban igen. */
export function expectsAlpha(doc: Pick<ImageDoc, 'layers'>, format: ExportExpect['format']): boolean {
  return format !== 'jpg' && !doc.layers.some((l) => l.kind === 'fill' && !l.hidden);
}

/** Egy réteg önmagában, átlátszó háttéren, a helyén: a többi réteg kimarad. */
export function layerOnlyDoc(doc: ImageDoc, layerId: string): ImageDoc | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  return layer ? { ...doc, id: `${doc.id}_layer`, layers: [{ ...layer, hidden: false } as ImageLayer], grade: undefined, adjust: undefined, vignette: undefined, grain: undefined } : null;
}

/** A kijelölt terület a réteg(ek)ből, átlátszó háttéren. */
export function selectionOnlyDoc(doc: ImageDoc, sel: Selection, layerId: string): ImageDoc | null {
  const only = layerOnlyDoc(doc, layerId);
  if (!only) {
    return null;
  }
  const layer = only.layers[0];
  if (layer.kind !== 'photo') {
    return null;
  }
  if (layer.mask) {
    const inverted = deleteSelection(only, layer.id, { ...sel, invert: !sel.invert });
    return inverted;
  }
  return { ...only, layers: [{ ...layer, mask: selectionToMask(sel) }] };
}

/** Méretcsomag egy kattintásra: ikonhoz, közösségi képhez és nyomtatáshoz is elég. */
export const EXPORT_PACK_SCALES = [1, 2, 3];
