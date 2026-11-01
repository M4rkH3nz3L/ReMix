import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import { magicWandOutline } from '@/lib/magicWand';
import type { CanvasPoint } from '@/lib/penPath';
import { boxToImage, imageToBox, type LayerFit } from '@/lib/wandMapping';
import { logCaught } from '@/lib/logCaught';

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
  tolerance = 32,
  placement: { boxAspect: number; fit: LayerFit } = { boxAspect: 1, fit: 'stretch' }
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
    // I33: a koppintás doboz-lokális, a pixelek a kép sajátjai — a `fit` köti össze őket
    const imageAspect = ow / oh;
    const seed = boxToImage({ x: u, y: v }, imageAspect, placement.boxAspect, placement.fit);
    if (!seed) {
      return null; // a `contain` margójára koppintott
    }
    const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x * (w - 1))));
    const sy = Math.max(0, Math.min(h - 1, Math.round(seed.y * (h - 1))));
    const outline = magicWandOutline(px, w, h, sx, sy, tolerance);
    return outline ? outline.map((p) => imageToBox(p, imageAspect, placement.boxAspect, placement.fit)) : null;
  } catch (caught) {
    logCaught('lib/magicWandClient.ts:magicWandSelect', caught);
    return null;
  }
}
