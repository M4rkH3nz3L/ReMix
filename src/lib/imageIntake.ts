// 🖼️ Bemeneti kép-normalizálás TERVE (pure, expo-mentes → tesztelhető).
//
// A prod-userek tetszőleges képet dobnak be (telefon-fotó fotó-rétegnek / varázs-
// pálca-forrásnak): HEIC/HEIF (iOS), 12000×9000 pixel, EXIF-forgatással. A három
// renderelő (on-device preview / worker `/imagedoc` ffmpeg / captureRef) eltérően
// (vagy sehogy) kezeli ezeket → a bevitelt EGYSZER normalizáljuk a bevételi ponton
// (`media.pickImage`): a re-encode (JPEG/PNG) BEÉGETI az EXIF-tájolást és HEIC→JPEG-et
// konvertál, a resize pedig a leghosszabb oldalt az alábbi korlátra kicsinyíti.
//
// Itt csak a DÖNTÉS él (mekkorára, kell-e); a tényleges manipuláció az expo-glue-ban
// (`media.ts` → `imageEditor.bakeImage`), hogy ez a mag önmagában tesztelhető maradjon.

import type { ImageOp } from '@/lib/imageEditor';

/** a szerkesztéshez elég + a 2160-as export 2×-ét is fedi, de a 12000px-es szörnyet levágja */
export const INTAKE_MAX_DIM = 3072;

/** a manipulátor által biztosan dekódolható kiterjesztések (üres/ismeretlen = hagyjuk, a natív dönt) */
const SUPPORTED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'tif', 'tiff', 'avif'];

/** az uri kiterjesztése kisbetűvel, query/hash nélkül ('' = nincs) */
export function imageExtOf(uri: string): string {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri || '');
  return m ? m[1].toLowerCase() : '';
}

/** támogatott kép-kiterjesztés? ('' / ismeretlen protokoll — pl. ph:// — → true, a natív réteg dönt) */
export function isSupportedImage(uri: string): boolean {
  const ext = imageExtOf(uri);
  return ext === '' || SUPPORTED_EXT.includes(ext);
}

export interface ResizePlan {
  width: number;
  height: number;
}

/**
 * A leghosszabb oldalt `maxDim`-re kicsinyíti, az arányt tartva. `null` = nem kell
 * kicsinyíteni (már elég kicsi), vagy a méret érvénytelen.
 */
export function planImageResize(width: number, height: number, maxDim = INTAKE_MAX_DIM): ResizePlan | null {
  if (![width, height].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }
  const longest = Math.max(width, height);
  if (longest <= maxDim) {
    return null;
  }
  const scale = maxDim / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A bevitt kép normalizáló művelet-sora: resize, HA a leghosszabb oldal > `maxDim`
 * — egyébként ÜRES (de a hívó így is re-encode-ol, hogy az EXIF-tájolás beégjen és
 * a HEIC JPEG-re konvertálódjon). A méret hiányában (ismeretlen) is üres → csak
 * re-encode (tájolás + formátum normalizálás).
 */
export function intakeOps(width?: number, height?: number, maxDim = INTAKE_MAX_DIM): ImageOp[] {
  if (width == null || height == null) {
    return [];
  }
  const plan = planImageResize(width, height, maxDim);
  return plan ? [{ type: 'resize', width: plan.width, height: plan.height }] : [];
}
