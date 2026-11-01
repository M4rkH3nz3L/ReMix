// 🎨 Színenkénti HSL (pure): nyolc színsáv saját árnyalat-, telítettség- és világosság-eltolással.
// A kliens `src/lib/hslBands.ts` ugyanez a képlet (a contract-teszt zárolja); a render ebből `.cube`-ot ír.
const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const CENTERS = [0, 30, 60, 120, 180, 240, 280, 320];
/** ±1-es csúszka hatása: árnyalat fokban, világosság a teljes skála arányában */
const HUE_RANGE = 30;
const LIGHT_RANGE = 0.35;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function isNeutralHsl(hsl) {
  return !hsl || !BANDS.some((b) => hsl[b] && (hsl[b].h || hsl[b].s || hsl[b].l));
}

/** A két szomszédos sáv között lineárisan oszlik meg a súly, így nincs ugrás. */
function bandWeights(hue) {
  const out = new Array(BANDS.length).fill(0);
  const h = ((hue % 360) + 360) % 360;
  for (let i = 0; i < CENTERS.length; i += 1) {
    const j = (i + 1) % CENTERS.length;
    const from = CENTERS[i];
    const to = j === 0 ? 360 : CENTERS[j];
    if (h >= from && h < to) {
      const t = (h - from) / (to - from);
      out[i] = 1 - t;
      out[j] = t;
      break;
    }
  }
  return out;
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) {
    return [0, 0, l];
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) {
    h = ((g - b) / d + 6) % 6;
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
}

/** Egy szín a sávok eltolásával. A szürke (nincs árnyalata) érintetlen marad. */
function shiftColor(r, g, b, hsl) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 1e-4) {
    return [r, g, b];
  }
  const w = bandWeights(h);
  let dh = 0;
  let ds = 0;
  let dl = 0;
  BANDS.forEach((name, i) => {
    const band = hsl[name];
    if (band && w[i] > 0) {
      dh += w[i] * (band.h || 0);
      ds += w[i] * (band.s || 0);
      dl += w[i] * (band.l || 0);
    }
  });
  return hslToRgb(h + dh * HUE_RANGE, clamp01(s * (1 + ds)), clamp01(l + dl * LIGHT_RANGE * s));
}

/** `.cube` szöveg a render `lut3d` szűrőjéhez. */
function hslCube(hsl, size = 33) {
  const rows = [`LUT_3D_SIZE ${size}`];
  const max = size - 1;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        rows.push(shiftColor(r / max, g / max, b / max, hsl).map((v) => v.toFixed(5)).join(' '));
      }
    }
  }
  return rows.join('\n');
}

module.exports = { BANDS, isNeutralHsl, bandWeights, shiftColor, hslCube };
