/**
 * 🔍 Vászon-zoom/pan mag (IMGEDD §8) — pure, tesztelhető. A Kép Stúdió vászna
 * NÉZEGETŐS zoomot kap: a tartalmat `scale`+`translate` transzformmal nagyítjuk,
 * a `pan`-t a keretben tartjuk. A szerkesztés 1:1-nél (zoom===1) történik; zoom>1-nél
 * a UI egy pan-overlayt tesz a vászonra, így a réteg-húzás koordináta-rendszere nem
 * sérül. Itt csak a SKALÁRIS matek él (clamp/lépés/pan-határ) — a gesztus a komponensé.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
const STEP = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** a zoom a [MIN,MAX] tartományba szorítva (2 tizedesre kerekítve a float-drift ellen) */
export function clampZoom(z: number): number {
  return round2(clamp(Number.isFinite(z) ? z : 1, ZOOM_MIN, ZOOM_MAX));
}

/** egy zoom-lépés: dir>0 nagyít (×1.5), dir<0 kicsinyít (÷1.5), a határokba szorítva */
export function zoomStep(z: number, dir: 1 | -1): number {
  return clampZoom(dir > 0 ? z * STEP : z / STEP);
}

/**
 * a pan-eltolás határokba szorítva: a nagyított tartalom szélei nem húzhatók beljebb
 * a kereten (max ±(box·(zoom-1)/2) px). Zoom===1-nél a pan mindig {0,0}.
 */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  box: { w: number; h: number }
): { x: number; y: number } {
  const z = clampZoom(zoom);
  if (z <= 1) {
    return { x: 0, y: 0 };
  }
  const maxX = (box.w * (z - 1)) / 2;
  const maxY = (box.h * (z - 1)) / 2;
  return { x: clamp(pan.x || 0, -maxX, maxX), y: clamp(pan.y || 0, -maxY, maxY) };
}

/** a vászon-transzform tömbje (a kerethez igazítva); zoom===1 → identitás (üres hatás). */
export function canvasTransform(
  zoom: number,
  pan: { x: number; y: number },
  box: { w: number; h: number }
): { translateX: number; translateY: number; scale: number } {
  const z = clampZoom(zoom);
  const p = clampPan(pan, z, box);
  return { translateX: p.x, translateY: p.y, scale: z };
}
