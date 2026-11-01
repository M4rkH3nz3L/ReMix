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

/** A dokumentum tartalmának azonosítója (a cache-mezők nélkül) — elavult render felismerésére. */
export function imageDocContentKey(doc: ImageDoc): string {
  return imageCacheKey(doc, 0, '', undefined, false);
}

/** A renderelt kép még a jelenlegi tartalmat mutatja-e? (régi doc-nál nincs kulcs → elavult) */
export function isRenderFresh(doc: ImageDoc): boolean {
  return !!doc.renderedUri && doc.renderedKey === imageDocContentKey(doc);
}

/** A szerver szándékosan elutasította a dokumentumot (413 stb.) — a fallback nem segít. */
export class ImageRenderRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRenderRejected';
  }
}

/** Az exportálható magasságok: a szerver ennél többet nem ad. */
export const EXPORT_HEIGHT_MIN = 240;
export const EXPORT_HEIGHT_MAX = 4096;

/** A kért magasság a dokumentum arányában, a korlátok közé szorítva. */
export function customExportSize(doc: { width?: number; height?: number; aspectRatio?: string }, height: number): { width: number; height: number } {
  const base = exportSize(doc as never, 1);
  const h = Math.max(EXPORT_HEIGHT_MIN, Math.min(EXPORT_HEIGHT_MAX, Math.round(Number.isFinite(height) ? height : base.height)));
  const w = Math.round((h * base.width) / base.height);
  // a széles kép szélessége is a plafon alatt marad
  return w > EXPORT_HEIGHT_MAX ? { width: EXPORT_HEIGHT_MAX, height: Math.round((EXPORT_HEIGHT_MAX * base.height) / base.width) } : { width: w, height: h };
}

/**
 * Durva fájlméret-becslés bájtban: fotónál a tartalom sok bitet ad, lapos grafikánál keveset.
 * Nagyságrendet mutat, a pontos méret a tartalomtól függ.
 */
export function estimateExportBytes(pixels: number, format: 'png' | 'jpg' | 'webp', quality: number, hasPhoto: boolean): number {
  const q = Math.max(0.3, Math.min(1, quality));
  const lossy = (hasPhoto ? 0.1 : 0.03) + q * q * (hasPhoto ? 0.5 : 0.1);
  const bytesPerPixel = format === 'png' ? (hasPhoto ? 1.6 : 0.15) : format === 'jpg' ? lossy : lossy * 0.7;
  return Math.round(pixels * bytesPerPixel);
}

/** Olvasható méret: 820 kB, 3,4 MB. */
export function formatBytes(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;
}
