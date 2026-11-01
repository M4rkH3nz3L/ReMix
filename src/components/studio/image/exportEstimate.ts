import { ImageFormat, Skia } from '@shopify/react-native-skia';

import { logCaught } from '@/lib/logCaught';

const SAMPLE = 256;
const MAX_PHOTOS = 3;
const FORMAT = { png: ImageFormat.PNG, jpg: ImageFormat.JPEG, webp: ImageFormat.WEBP };
/** a szerver kódolója a veszteséges képet a kis mintánál jóval tömörebbre veszi: mért arány 3,3 */
const LOSSY_CORRECTION = 0.3;

/**
 * A fájlméret a tartalmon múlik, ezért a fotókat kicsiben valóban tömörítjük, és ebből adódik a
 * bájt/pixel. A kis minta valamivel sűrűbb a nagy képnél, így a becslés inkább felfelé téved.
 * null: nincs mérhető fotó, a hívó a tartalom nélküli becslést használja.
 */
export async function photoBytesPerPixel(uris: string[], format: 'png' | 'jpg' | 'webp', quality: number): Promise<number | null> {
  const samples: number[] = [];
  for (const uri of uris.slice(0, MAX_PHOTOS)) {
    try {
      const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
      const surface = Skia.Surface.MakeOffscreen(SAMPLE, SAMPLE);
      if (!image || !surface) {
        continue;
      }
      surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, SAMPLE, SAMPLE), Skia.Paint());
      surface.flush();
      samples.push(((format === 'png' ? 1 : LOSSY_CORRECTION) * surface.makeImageSnapshot().encodeToBytes(FORMAT[format], Math.round(quality * 100)).length) / (SAMPLE * SAMPLE));
    } catch (caught) {
      logCaught('components/studio/image/exportEstimate.ts', caught);
    }
  }
  return samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
}
