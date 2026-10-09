import { effectiveCanvas } from '@/lib/canvasPresets';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

/**
 * ✂️ Kivágás-téglalap a JELENLEGI vászon terében, 0–1 normalizálva.
 * `x`/`y` a BAL-FELSŐ sarok, `w`/`h` a méret (a réteg-`position`-nel ellentétben,
 * ami középpont). A kivágott régió lesz az új vászon.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A kivágás-téglalapot a vászonba (0–1) szorítja, és minimális méretet tart
 * (különben a crop → 0-osztás / eltűnő vászon lenne). A szélesség/magasság
 * előbb a minimumra, majd a pozíció úgy, hogy a téglalap bent maradjon.
 */
export function clampCropRect(rect: CropRect, minSize = 0.05): CropRect {
  const w = clamp(rect.w, minSize, 1);
  const h = clamp(rect.h, minSize, 1);
  const x = clamp(rect.x, 0, 1 - w);
  const y = clamp(rect.y, 0, 1 - h);
  return { x, y, w, h };
}

/** a téglalap mozgatása (a méret marad, a vásznon belül tartva) */
export function moveCropRect(rect: CropRect, dx: number, dy: number): CropRect {
  return clampCropRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

export type CropCorner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Egy sarok húzása — a SZEMBEN lévő sarok marad fix. A `dx`/`dy` normalizált
 * (a vászon-doboz arányában). Negatívba forduló méretet a clamp fog meg.
 */
export function resizeCropCorner(rect: CropRect, corner: CropCorner, dx: number, dy: number): CropRect {
  let { x, y, w, h } = rect;
  if (corner === 'br') {
    w = rect.w + dx;
    h = rect.h + dy;
  } else if (corner === 'tr') {
    w = rect.w + dx;
    y = rect.y + dy;
    h = rect.h - dy;
  } else if (corner === 'bl') {
    x = rect.x + dx;
    w = rect.w - dx;
    h = rect.h + dy;
  } else {
    // tl
    x = rect.x + dx;
    w = rect.w - dx;
    y = rect.y + dy;
    h = rect.h - dy;
  }
  return clampCropRect({ x, y, w, h });
}

/**
 * Középre igazított, MAXIMÁLIS kivágás-téglalap egy cél pixel-arányhoz (w:h).
 * `ratio == null` → a teljes vászon ({0,0,1,1}). A vászon saját aránya alapján
 * számol, hogy a visszaadott normalizált téglalap pixel-aránya pont `ratio` legyen.
 */
export function aspectCropRect(doc: Pick<ImageDoc, 'aspectRatio' | 'width' | 'height'>, ratio: number | null): CropRect {
  if (ratio == null || !(ratio > 0)) {
    return { ...FULL_CROP };
  }
  const { width: W, height: H } = effectiveCanvas(doc);
  const canvasRatio = W / H;
  // pw/ph = ratio, és a téglalap beférjen a vászonba (pw<=W, ph<=H)
  let rw: number;
  let rh: number;
  if (ratio >= canvasRatio) {
    // szélesebb, mint a vászon → a szélesség a korlát
    rw = 1;
    rh = canvasRatio / ratio;
  } else {
    rh = 1;
    rw = ratio / canvasRatio;
  }
  return clampCropRect({ x: (1 - rw) / 2, y: (1 - rh) / 2, w: rw, h: rh });
}

/** egy középpont-pozíciót a kivágás terébe képez (lehet 0–1-en kívül = levágva) */
function remapPos(p: { x: number; y: number }, r: CropRect): { x: number; y: number } {
  return { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
}

/**
 * A rétegek újraleképezése a kivágás terébe úgy, hogy az ABSZOLÚT pixel-megjelenés
 * megmaradjon: a pozíció a kivágás origójához képest, a szélesség a kivágás
 * szélességével, a magasság-% (méret/vonalvastagság/betűméret/glow) a kivágás
 * magasságával skálázódik. A háttér-fill a teljes (új) vásznon marad.
 */
function remapLayer(layer: ImageLayer, r: CropRect): ImageLayer {
  if (layer.kind === 'fill') {
    return layer;
  }
  if (layer.kind === 'photo') {
    const next: PhotoLayer = {
      ...layer,
      position: remapPos(layer.position, r),
      w: layer.w / r.w,
      h: layer.h / r.h,
    };
    return next;
  }
  if (layer.kind === 'shape') {
    const next: ShapeLayer = {
      ...layer,
      position: remapPos(layer.position, r),
      w: layer.w / r.w,
      h: layer.h / r.h,
    };
    // a vászon-MAGASSÁG arányos mezők (px-azonosság megtartása)
    if (layer.strokeWidth != null) {
      next.strokeWidth = layer.strokeWidth / r.h;
    }
    if (layer.borderWidth != null) {
      next.borderWidth = layer.borderWidth / r.h;
    }
    if (layer.glow) {
      next.glow = { ...layer.glow, size: layer.glow.size / r.h };
    }
    return next;
  }
  // text: pozíció + betűméret (a magasság %-a); a tipográfia em-arányok → maradnak
  const next: TextLayer = {
    ...layer,
    position: remapPos(layer.position, r),
    fontSize: layer.fontSize / r.h,
  };
  return next;
}

/**
 * ✂️ A dokumentum KIVÁGÁSA a megadott (normalizált) téglalapra: új vászon-pixelméret
 * + minden réteg újraleképezve (a kivágott régión kívüli tartalom a rétegen megmarad,
 * csak a vászon vágja le). A `renderedUri` cache érvénytelenítve. Tiszta, undo-zható
 * transzformáció — a kép-doc render (normalizált koordináták) paritásban marad.
 */
export function cropImageDoc(doc: ImageDoc, rect: CropRect): ImageDoc {
  const r = clampCropRect(rect);
  const { width: W, height: H } = effectiveCanvas(doc);
  const width = Math.max(16, Math.round(W * r.w));
  const height = Math.max(16, Math.round(H * r.h));
  return {
    ...doc,
    width,
    height,
    layers: doc.layers.map((l) => remapLayer(l, r)),
    renderedUri: undefined,
  };
}
