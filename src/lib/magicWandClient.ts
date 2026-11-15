import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import { colorRangeRings, type RangeRing } from '@/lib/colorRange';
import { gradientMagnitude, refineRingToEdges } from '@/lib/edgeRefine';
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

/**
 * 🎯 S17: színtartomány — a koppintott szín MINDEN hasonló képpontja (nem csak az összefüggő régió),
 * a lyukakkal; a gyűrűk a fotó-doboz 0–1 terében, a kijelölés műveleteinek sorrendjében.
 */
export async function colorRangeSelect(
  uri: string,
  u: number,
  v: number,
  tolerance = 32,
  placement: { boxAspect: number; fit: LayerFit } = { boxAspect: 1, fit: 'stretch' }
): Promise<RangeRing[] | null> {
  try {
    const src = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!src || !src.width() || !src.height()) {
      return null;
    }
    const [ow, oh] = [src.width(), src.height()];
    const scale = Math.min(1, MAX_DIM / Math.max(ow, oh));
    const [w, h] = [Math.max(1, Math.round(ow * scale)), Math.max(1, Math.round(oh * scale))];
    let img = src;
    if (scale < 1) {
      const surface = Skia.Surface.MakeOffscreen(w, h);
      if (surface) {
        surface.getCanvas().drawImageRect(src, Skia.XYWHRect(0, 0, ow, oh), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
        img = surface.makeImageSnapshot();
      }
    }
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px || !(px instanceof Uint8Array)) {
      return null;
    }
    const imageAspect = ow / oh;
    const seed = boxToImage({ x: u, y: v }, imageAspect, placement.boxAspect, placement.fit);
    if (!seed) {
      return null;
    }
    const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x * (w - 1))));
    const sy = Math.max(0, Math.min(h - 1, Math.round(seed.y * (h - 1))));
    const rings = colorRangeRings(px, w, h, sx, sy, tolerance);
    return rings.map((r) => ({ op: r.op, points: r.points.map((p) => imageToBox(p, imageAspect, placement.boxAspect, placement.fit)) }));
  } catch (caught) {
    logCaught('lib/magicWandClient.ts:colorRangeSelect', caught);
    return null;
  }
}

/**
 * 🧲 S17: él-finomítás — a kijelölés gyűrűi (a fotó-doboz 0–1 terében) a fotó valódi éleire húzva.
 * A `contain` margójára eső pont a helyén marad. `null`, ha a kép nem olvasható.
 */
export async function refineSelectionToEdges(
  uri: string,
  rings: CanvasPoint[][],
  placement: { boxAspect: number; fit: LayerFit } = { boxAspect: 1, fit: 'stretch' },
  /** a keresés sugara a kép hosszabb oldalának arányában (egy kézi lasszó tipikus eltérése) */
  radiusFrac = 0.04
): Promise<CanvasPoint[][] | null> {
  try {
    const src = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!src || !src.width() || !src.height()) {
      return null;
    }
    const [ow, oh] = [src.width(), src.height()];
    const scale = Math.min(1, MAX_DIM / Math.max(ow, oh));
    const [w, h] = [Math.max(1, Math.round(ow * scale)), Math.max(1, Math.round(oh * scale))];
    let img = src;
    if (scale < 1) {
      const surface = Skia.Surface.MakeOffscreen(w, h);
      if (surface) {
        surface.getCanvas().drawImageRect(src, Skia.XYWHRect(0, 0, ow, oh), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
        img = surface.makeImageSnapshot();
      }
    }
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px || !(px instanceof Uint8Array)) {
      return null;
    }
    const grad = gradientMagnitude(px, w, h);
    const imageAspect = ow / oh;
    return rings.map((ring) => {
      const inImage = ring.map((p) => boxToImage(p, imageAspect, placement.boxAspect, placement.fit));
      if (inImage.some((p) => !p)) {
        return ring; // a gyűrű a kép margójára is esik: érintetlen
      }
      const radius = Math.max(8, Math.round(radiusFrac * Math.max(w, h)));
      const refined = refineRingToEdges(grad, w, h, inImage.map((p) => ({ x: p!.x * (w - 1), y: p!.y * (h - 1) })), radius);
      return refined.map((p) => imageToBox({ x: p.x / (w - 1), y: p.y / (h - 1) }, imageAspect, placement.boxAspect, placement.fit));
    });
  } catch (caught) {
    logCaught('lib/magicWandClient.ts:refineSelectionToEdges', caught);
    return null;
  }
}
