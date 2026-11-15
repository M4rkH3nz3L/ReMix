import { File } from 'expo-file-system';

import { P3_TO_SRGB_SHADER, embeddedProfileName, heifHasAlpha, profileKind, type ProfileKind } from '@/lib/colorProfile';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎨 S16: a bevitt kép sRGB-re hozása az eszközön (a tiszta képlet a `colorProfile.ts`-ben). A Skia
 * offscreen felülete nem színkezel (eszközön mérve), így a gyerek-kép nyers P3-értékeit a shader váltja,
 * a kimenet profil nélküli (= sRGB) fájl — a vászon, a telefonos és a szerveres render is ezt látja.
 */

// a Skia lustán töltődik: a `media.ts` (és rajta át sok teszt) ne húzza be a natív modult
let effect: unknown = null;

export interface SrgbResult {
  kind: ProfileKind;
  converted: boolean;
}

/** a fájl helyben sRGB-re váltva, ha Display P3; más profilnál (ritka) érintetlen, csak naplózva */
export async function toSrgbIfNeeded(uri: string): Promise<SrgbResult> {
  try {
    const file = new File(uri);
    const bytes = await file.bytes();
    const kind = profileKind(embeddedProfileName(bytes));
    if (kind !== 'display-p3') return { kind, converted: false };
    const { FilterMode, ImageFormat, MipmapMode, Skia, TileMode } = await import('@shopify/react-native-skia');
    const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
    effect ??= Skia.RuntimeEffect.Make(P3_TO_SRGB_SHADER);
    const fx = effect as ReturnType<typeof Skia.RuntimeEffect.Make>;
    if (!img || !fx) return { kind, converted: false };
    const [w, h] = [img.width(), img.height()];
    const surface = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
    if (!surface) return { kind, converted: false };
    const paint = Skia.Paint();
    paint.setShader(fx.makeShaderWithChildren([], [img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None)]));
    surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, w, h), paint);
    surface.flush();
    const png = bytes[0] === 0x89;
    const out = surface.makeImageSnapshot().encodeToBytes(png ? ImageFormat.PNG : ImageFormat.JPEG, png ? 100 : 95);
    if (!out?.length) return { kind, converted: false };
    file.write(out);
    return { kind, converted: true };
  } catch (caught) {
    logCaught('lib/colorIntakeClient.ts:toSrgbIfNeeded', caught);
    return { kind: 'none', converted: false };
  }
}

/** HEIC/HEIF/AVIF: van-e alfa (akkor PNG-be kell kódolni, a JPEG elvesztené) */
export async function heifKeepsAlpha(uri: string): Promise<boolean> {
  if (!/\.(heic|heif|avif)(\?|$)/i.test(uri)) return false;
  try {
    return heifHasAlpha(await new File(uri).bytes());
  } catch (caught) {
    logCaught('lib/colorIntakeClient.ts:heifKeepsAlpha', caught);
    return false;
  }
}
