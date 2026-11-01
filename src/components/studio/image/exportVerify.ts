import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import { type ExportExpect, type ExportFacts, type ExportProblem, exportProblems } from '@/lib/imageExportCheck';
import { logCaught } from '@/lib/logCaught';

const SAMPLE = 64;

/** A kész fájl visszaolvasása: amit a felhasználó kap, azt ellenőrizzük, nem a szándékot. */
export async function readExportFacts(uri: string): Promise<ExportFacts> {
  const none: ExportFacts = { opened: false, width: 0, height: 0, bytes: 0, hasAlpha: false };
  try {
    const bytes = new File(uri).size ?? 0;
    const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    const surface = Skia.Surface.MakeOffscreen(SAMPLE, SAMPLE);
    if (!image || !surface) {
      return { ...none, bytes };
    }
    surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, SAMPLE, SAMPLE), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: SAMPLE, height: SAMPLE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    let hasAlpha = false;
    if (px instanceof Uint8Array) {
      for (let i = 3; i < px.length && !hasAlpha; i += 4) {
        hasAlpha = px[i] < 250;
      }
    }
    return { opened: true, width: image.width(), height: image.height(), bytes, hasAlpha };
  } catch (caught) {
    logCaught('components/studio/image/exportVerify.ts', caught);
    return none;
  }
}

export async function verifyExport(uri: string, expect: ExportExpect): Promise<ExportProblem[]> {
  return exportProblems(await readExportFacts(uri), expect);
}
