import type { HslBand, HslBands } from '@/types/project';

/**
 * 🎨 Színenkénti HSL (pure): nyolc színsáv saját árnyalat-, telítettség- és világosság-eltolással.
 * A worker `server/hslBands.js` ugyanez a képlet, a contract-teszt zárolja az egyezést.
 */
export const HSL_BANDS: { key: HslBand; color: string }[] = [
  { key: 'red', color: '#ff3b30' },
  { key: 'orange', color: '#ff9500' },
  { key: 'yellow', color: '#ffcc00' },
  { key: 'green', color: '#34c759' },
  { key: 'aqua', color: '#32d2d2' },
  { key: 'blue', color: '#0a84ff' },
  { key: 'purple', color: '#8e5cf7' },
  { key: 'magenta', color: '#ff2d95' },
];

const CENTERS = [0, 30, 60, 120, 180, 240, 280, 320];
/** ±1-es csúszka hatása: árnyalat fokban, világosság a teljes skála arányában */
const HUE_RANGE = 30;
const LIGHT_RANGE = 0.35;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function isNeutralHsl(hsl: HslBands | undefined): boolean {
  return !hsl || !HSL_BANDS.some(({ key }) => hsl[key]?.h || hsl[key]?.s || hsl[key]?.l);
}

/** A két szomszédos sáv között lineárisan oszlik meg a súly, így nincs ugrás. */
export function bandWeights(hue: number): number[] {
  const out = new Array<number>(CENTERS.length).fill(0);
  const h = ((hue % 360) + 360) % 360;
  for (let i = 0; i < CENTERS.length; i++) {
    const j = (i + 1) % CENTERS.length;
    const [from, to] = [CENTERS[i], j === 0 ? 360 : CENTERS[j]];
    if (h >= from && h < to) {
      const t = (h - from) / (to - from);
      out[i] = 1 - t;
      out[j] = t;
      break;
    }
  }
  return out;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) {
    return [0, 0, l];
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
}

/** Egy szín a sávok eltolásával. A szürke (nincs árnyalata) érintetlen marad. */
export function shiftColor(r: number, g: number, b: number, hsl: HslBands): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 1e-4) {
    return [r, g, b];
  }
  const w = bandWeights(h);
  let [dh, ds, dl] = [0, 0, 0];
  HSL_BANDS.forEach(({ key }, i) => {
    const band = hsl[key];
    if (band && w[i] > 0) {
      dh += w[i] * (band.h ?? 0);
      ds += w[i] * (band.s ?? 0);
      dl += w[i] * (band.l ?? 0);
    }
  });
  return hslToRgb(h + dh * HUE_RANGE, clamp01(s * (1 + ds)), clamp01(l + dl * LIGHT_RANGE * s));
}
