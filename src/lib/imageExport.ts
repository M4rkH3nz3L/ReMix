import { CANVAS_MAX, effectiveCanvas } from '@/lib/canvasPresets';
import type { ImageDoc } from '@/types/project';

/**
 * 📤 A kép-export tiszta magja (expo-mentes): a kimeneti méret és a cache-kulcs.
 * A méret a worker `docCanvas`-ának tükre (contract-teszt köti össze): a skála a
 * dokumentum méretét szorozza, a leghosszabb oldal plafonja aránytartó.
 */

const even = (n: number) => Math.round(n / 2) * 2;

/** A tényleges kimeneti pixelméret az adott skálán. */
export function exportSize(doc: Pick<ImageDoc, 'width' | 'height' | 'aspectRatio'>, scale: number): { width: number; height: number } {
  const base = effectiveCanvas(doc);
  const s = Math.min(scale, CANVAS_MAX / Math.max(base.width, base.height));
  return { width: even(base.width * s), height: even(base.height * s) };
}

/**
 * Az export-cache kulcsa: MINDEN, ami a kimenetet befolyásolja. A csomag (`pro`) is
 * benne van, különben Pro-váltás után a vízjeles cache-kép jönne vissza.
 */
export function imageCacheKey(doc: ImageDoc, height: number, fmt: string, quality: number | undefined, pro: boolean): string {
  const src = JSON.stringify({
    a: doc.aspectRatio,
    w: doc.width,
    h: doc.height,
    f: doc.format,
    l: doc.layers,
    g: doc.groups,
    dg: doc.grade,
    da: doc.adjust,
    dv: doc.vignette,
    dn: doc.grain,
    oh: height,
    of: fmt,
    oq: quality ?? null,
    pro,
  });
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** A szerver szándékosan elutasította a dokumentumot (413 stb.) — a fallback nem segít. */
export class ImageRenderRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRenderRejected';
  }
}
