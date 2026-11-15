import { visibleLayers } from '@/lib/imageDoc';
import type { ImageDoc } from '@/types/project';

/**
 * 🧭 A kép-render útvonala (CORE K1 · IMAGE-PROD C1): offline first.
 *
 * A dokumentum elsőként a TELEFONON raszterizálódik (a vászon nézet-fája egy rejtett
 * render-színpadon, doc-felbontáson — ugyanaz a fa, amelyet a füstteszt a szerverrel
 * paritásban mér). A workerre csak akkor van szükség, ha a lapon olyan effekt van, amelynek
 * nincs telefonos előnézete (lásd `serverOnlyEffects`) — és akkor is csak, ha elérhető.
 * Expo-mentes, önmagában tesztelhető.
 */

/** a csak a szerver-renderben létező fotó-effektek (`server/imagedoc.js` DEVELOP_DETAIL_*) */
export type ServerOnlyEffect = 'noiseReduction' | 'chromaticAberration' | 'lensDistortion';

const SERVER_ONLY: ServerOnlyEffect[] = ['noiseReduction', 'chromaticAberration', 'lensDistortion'];

/** A látható rétegeken használt, telefonon nem rajzolható effektek (ismétlés nélkül). */
export function serverOnlyEffects(doc: ImageDoc): ServerOnlyEffect[] {
  const found = new Set<ServerOnlyEffect>();
  for (const layer of visibleLayers(doc)) {
    if (layer.kind !== 'photo') continue;
    const detail = layer.develop?.detail;
    if (!detail) continue;
    for (const key of SERVER_ONLY) {
      if (Math.abs(detail[key] ?? 0) > 1e-6) found.add(key);
    }
  }
  return SERVER_ONLY.filter((k) => found.has(k));
}

export type ImageRenderRoute = 'device' | 'worker';

/**
 * Melyik úton raszterizáljunk? A telefon az alap; a worker csak a telefonon nem rajzolható
 * effektek miatt, és csak ha van (`workerAvailable`). Ha nincs worker, a telefon renderel, a
 * hívó jelzi, mely effektek maradtak ki (`serverOnlyEffects`).
 */
export function chooseImageRenderRoute(doc: ImageDoc, workerAvailable: boolean): ImageRenderRoute {
  return workerAvailable && serverOnlyEffects(doc).length > 0 ? 'worker' : 'device';
}

/**
 * a színpad leghosszabb oldala legalább ennyi pont: kis pontméreten a betűk szélessége nem
 * arányosan kicsinyedik, és a szöveg máshol tördel, mint a vásznon (eszközön mérve: 640 px-es
 * story 120 pont szélesen „ÚJDONSÁ/G”)
 */
export const STAGE_MIN_LONG_PT = 720;

/**
 * A render-színpad mérete: a kimeneti kép pixelmérete (`widthPx`×`heightPx`, a vászon arányában),
 * a rajzolás pontmérete (`w`×`h`, legalább `STAGE_MIN_LONG_PT` a hosszabb oldalon), és a rögzítés
 * mérete pontban (`capW`×`capH` — a natív kép = a kért pixelek; ha a rajz nagyobb, kicsinyít).
 */
export function stageSize(
  canvas: { width: number; height: number },
  heightPx: number,
  pixelRatio: number
): { widthPx: number; heightPx: number; w: number; h: number; capW: number; capH: number } {
  const h = Math.max(1, Math.round(heightPx));
  const widthPx = Math.max(1, Math.round((h * canvas.width) / canvas.height));
  const r = pixelRatio > 0 ? pixelRatio : 1;
  const capW = widthPx / r;
  const capH = h / r;
  const up = Math.max(1, STAGE_MIN_LONG_PT / Math.max(capW, capH));
  return { widthPx, heightPx: h, w: capW * up, h: capH * up, capW, capH };
}

/**
 * Mennyit várjon a színpad a rajzra a felcsatolás után (ms): a fotók és maszkok képe
 * aszinkron töltődik (Skia `useImage`, expo-image). Rétegszámmal nő, felül korlátos.
 */
export function stageSettleMs(doc: ImageDoc): number {
  const media = visibleLayers(doc).reduce((n, l) => {
    if (l.kind !== 'photo') return n;
    return n + 1 + (l.mask?.image ? 1 : 0) + (l.lut ? 1 : 0);
  }, 0);
  return Math.min(2500, 250 + media * 200);
}
