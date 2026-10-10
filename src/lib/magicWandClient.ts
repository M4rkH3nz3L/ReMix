import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import { magicWandOutline } from '@/lib/magicWand';
import type { CanvasPoint } from '@/lib/penPath';

/** a flood-fill költsége O(px) → nagy képet erre a hosszabb-oldal-méretre skálázunk */
const MAX_DIM = 900;

/**
 * 🪄 Varázspálca GLUE (Skia) — beolvassa a fotó nyers pixeleit, és a kattintás
 * pontjából (a fotó-doboz 0–1 lokális koordinátái) kijelölés-körvonalat ad a
 * tiszta `magicWandOutline` maggal. Nagy képet MAX_DIM-re skáláz (offscreen Skia
 * felület) a teljesítményért. A natív Skia-modul miatt ÚJ dev-build után fut.
 */
export async function magicWandSelect(
  uri: string,
  u: number,
  v: number,
  tolerance = 32
): Promise<CanvasPoint[] | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    const src = Skia.Image.MakeImageFromEncoded(data);
    if (!src) {
      return null;
    }
    const ow = src.width();
    const oh = src.height();
    if (!ow || !oh) {
      return null;
    }
    const scale = Math.min(1, MAX_DIM / Math.max(ow, oh));
    let w = ow;
    let h = oh;
    let img = src;
    if (scale < 1) {
      w = Math.max(1, Math.round(ow * scale));
      h = Math.max(1, Math.round(oh * scale));
      const surface = Skia.Surface.MakeOffscreen(w, h);
      if (surface) {
        surface
          .getCanvas()
          .drawImageRect(src, Skia.XYWHRect(0, 0, ow, oh), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
        img = surface.makeImageSnapshot();
      }
    }
    const px = img.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!px || !(px instanceof Uint8Array)) {
      return null;
    }
    const sx = Math.max(0, Math.min(w - 1, Math.round(u * (w - 1))));
    const sy = Math.max(0, Math.min(h - 1, Math.round(v * (h - 1))));
    return magicWandOutline(px, w, h, sx, sy, tolerance);
  } catch {
    return null;
  }
}
