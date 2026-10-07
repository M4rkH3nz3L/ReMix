import { aspectValue } from '@/constants/editor';
import type { AspectRatio } from '@/types/project';

/**
 * 🖼️ Közös vászon-konstansok + segédek a kép-editorhoz — EGY forrás a
 * létrehozó-űrlapnak (`studio/index.tsx`) és a vászon-beállítás-lapnak
 * (`CanvasSheet.tsx`), hogy a presetek/korlátok/validáció ne csússzanak szét.
 */

/** gyakori vászon-méret presetek (px). */
export const CANVAS_PRESETS: { w: number; h: number; label: string }[] = [
  { w: 1080, h: 1080, label: '1080²' },
  { w: 1080, h: 1920, label: '1080×1920' },
  { w: 1080, h: 1350, label: '1080×1350' },
  { w: 1920, h: 1080, label: '1920×1080' },
  { w: 2048, h: 2048, label: '2048²' },
  { w: 1024, h: 1024, label: '1024²' },
];

export const CANVAS_MIN = 16;
export const CANVAS_MAX = 4096; // a szerver-render felső határa

/** háttérszín-minták (az első az eddigi alap sötét). */
export const BG_SWATCHES = ['#12121a', '#000000', '#ffffff', '#1e293b', '#0f172a'];

/** szabad W×H → a legközelebbi arány-enum (a projekt-szintű aspectRatio-hoz). */
export function nearestAspect(w: number, h: number): AspectRatio {
  const r = w / Math.max(1, h);
  const opts: { id: AspectRatio; v: number }[] = [
    { id: '16:9', v: 16 / 9 },
    { id: '9:16', v: 9 / 16 },
    { id: '1:1', v: 1 },
  ];
  return opts.reduce((best, cur) => (Math.abs(cur.v - r) < Math.abs(best.v - r) ? cur : best)).id;
}

/** px-érték parse + [CANVAS_MIN, CANVAS_MAX] közé zárás (a W/H mezőkhöz). */
export function clampDim(value: string | number): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, n));
}

/** elfogadható #RGB / #RRGGBB hex (a custom háttér-mezőhöz). */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/**
 * Egy `ImageDoc` effektív pixel-mérete: az explicit W×H, különben a 3-arányos
 * enumból egy ésszerű alap-felbontással (a rövidebb él 1080). Az editor ebből
 * tölti a vászon-mezőket, ha a dokumentumnak még nincs explicit mérete.
 */
export function effectiveCanvas(doc: { width?: number; height?: number; aspectRatio: AspectRatio }): {
  width: number;
  height: number;
} {
  if (doc.width && doc.height) {
    return { width: doc.width, height: doc.height };
  }
  const r = aspectValue(doc.aspectRatio);
  return r >= 1
    ? { width: Math.round(1080 * r), height: 1080 }
    : { width: 1080, height: Math.round(1080 / r) };
}
