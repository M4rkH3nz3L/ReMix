/**
 * 🔍 Munkaterület-nézet (pure): a zoom/pan a TELJES nézetet mozgatja — a vásznat a körülötte
 * lévő területtel együtt, ahogy a profi szerkesztőkben. A dokumentum nem változik. Kicsinyítve
 * látszik, ami kilóg a vászonról, és elérhetők a vásznon túli fogók. Itt csak a skaláris matek
 * él (clamp/lépés/pan-határ) — a gesztus a komponensé.
 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
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
 * 🤏 Csippentés → zoom: a csippentés kezdetén érvényes `startZoom`-ot a `scale`-lel
 * (a gesztus kezdete óta mért relatív nagyítás) szorozza, a [MIN,MAX] tartományba
 * szorítva. A gesztus-komponens a csippentés kezdetén rögzíti a `startZoom`-ot.
 */
export function pinchZoom(startZoom: number, scale: number): number {
  return clampZoom((Number.isFinite(startZoom) ? startZoom : 1) * (scale > 0 ? scale : 1));
}

/**
 * A pan határa: a vászon nem veszhet el a nézetből — a közepe legfeljebb a saját (nagyított)
 * fél méretével + a méret negyedével tolható el.
 */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  box: { w: number; h: number }
): { x: number; y: number } {
  const z = clampZoom(zoom);
  const maxX = box.w * z * 0.5 + box.w * 0.25;
  const maxY = box.h * z * 0.5 + box.h * 0.25;
  return { x: clamp(pan.x || 0, -maxX, maxX), y: clamp(pan.y || 0, -maxY, maxY) };
}

/**
 * 🤏 Csippentés a fókuszpont körül: a nézet ujjak alatti pontja helyben marad, és a két ujj
 * együttes mozgása tolja a nézetet. A `focal` a munkaterület közepéhez mért pont.
 */
export function pinchAt(
  start: { zoom: number; pan: { x: number; y: number }; focal: { x: number; y: number } },
  scale: number,
  focal: { x: number; y: number },
  box: { w: number; h: number }
): { zoom: number; pan: { x: number; y: number } } {
  const zoom = pinchZoom(start.zoom, scale);
  const k = zoom / start.zoom;
  return {
    zoom,
    pan: clampPan({ x: focal.x - (start.focal.x - start.pan.x) * k, y: focal.y - (start.focal.y - start.pan.y) * k }, zoom, box),
  };
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
