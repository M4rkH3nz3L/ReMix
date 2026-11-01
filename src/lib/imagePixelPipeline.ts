import type { ClipAdjust, FilterId, GradeId, PhotoLayer } from '@/types/project';

/**
 * 🎨 A kép-export színműveletei egy pixelre, tiszta függvényként (RGB 0–1). Ugyanazokat a
 * képleteket követi, mint a render ffmpeg-szűrői, a valódi kimenethez mérve
 * (`imagePixelPipeline.test.ts`). Ebből készül az előnézet 3D LUT-ja, így a vászon nem
 * közelítő tintet, hanem az export színét mutatja. A térbeli műveletek (blur, élesítés,
 * zaj, vignetta) nem pixelenkéntiek, azok külön kezelendők.
 */
export type Rgb = [number, number, number];
type Op = (c: Rgb) => Rgb;

const cl = (v: number) => Math.max(0, Math.min(1, v));
const clNum = (v: number | undefined, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

// ffmpeg `eq`: Y′CbCr térben (BT.601, korlátozott tartomány) dolgozik
function rgbToYuv([r, g, b]: Rgb): Rgb {
  return [
    (16 + 65.481 * r + 128.553 * g + 24.966 * b) / 255,
    (128 - 37.797 * r - 74.203 * g + 112 * b) / 255,
    (128 + 112 * r - 93.786 * g - 18.214 * b) / 255,
  ];
}
function yuvToRgb([y, u, v]: Rgb): Rgb {
  const Y = (y * 255 - 16) * 1.164384;
  const U = u * 255 - 128;
  const V = v * 255 - 128;
  return [cl((Y + 1.596027 * V) / 255), cl((Y - 0.391762 * U - 0.812968 * V) / 255), cl((Y + 2.017232 * U) / 255)];
}

function eqOp(brightness: number, contrast: number, saturation: number, gamma = 1): Op {
  return (c) => {
    const [y, u, v] = rgbToYuv(c);
    let Y = ((y - 0.5) * contrast + 0.5 + brightness);
    if (gamma !== 1) {
      Y = Math.pow(cl(Y), 1 / gamma);
    }
    return yuvToRgb([cl(Y), 0.5 + (u - 0.5) * saturation, 0.5 + (v - 0.5) * saturation]);
  };
}

/** természetes köbös spline, ahogy az ffmpeg `curves` szűrője interpolál */
function splineLut(points: [number, number][]): (x: number) => number {
  const n = points.length;
  if (n < 3) {
    const [[x0, y0], [x1, y1]] = points;
    return (x) => cl(y0 + ((x - x0) / Math.max(1e-6, x1 - x0)) * (y1 - y0));
  }
  const h = points.slice(0, -1).map((p, i) => points[i + 1][0] - p[0]);
  const a: number[] = new Array(n).fill(0);
  const b: number[] = new Array(n).fill(2);
  const c: number[] = new Array(n).fill(0);
  const d: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i - 1];
    b[i] = 2 * (h[i - 1] + h[i]);
    c[i] = h[i];
    d[i] = 6 * ((points[i + 1][1] - points[i][1]) / h[i] - (points[i][1] - points[i - 1][1]) / h[i - 1]);
  }
  b[0] = b[n - 1] = 1;
  for (let i = 1; i < n; i++) {
    const m = a[i] / b[i - 1];
    b[i] -= m * c[i - 1];
    d[i] -= m * d[i - 1];
  }
  const s: number[] = new Array(n).fill(0);
  s[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    s[i] = (d[i] - c[i] * s[i + 1]) / b[i];
  }
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > points[i + 1][0]) i += 1;
    const t = x - points[i][0];
    const hi = h[i];
    const y =
      points[i][1] +
      t * ((points[i + 1][1] - points[i][1]) / hi - (hi * (2 * s[i] + s[i + 1])) / 6) +
      (t * t * s[i]) / 2 +
      (t * t * t * (s[i + 1] - s[i])) / (6 * hi);
    return cl(y);
  };
}

/** ffmpeg `colortemperature`: a Kelvinből számolt RGB-szorzó */
function kelvinRgb(k: number): Rgb {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 1;
    g = 0.3900815787690196 * Math.log(t) - 0.6318414437886275;
  } else {
    const u = Math.max(t - 60, 0);
    r = 1.292936186062745 * Math.pow(u, -0.1332047592);
    g = 1.129890860895294 * Math.pow(u, -0.0755148492);
  }
  if (t >= 66) {
    b = 1;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 0.5432067891101961 * Math.log(t - 10) - 1.196254089143529;
  }
  return [cl(r), cl(g), cl(b)];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** ffmpeg `lutrgb` tint-keverés: v·(1−op) + szín·op */
function tintOp(rgb: Rgb, op: number): Op {
  return (c) => [c[0] * (1 - op) + rgb[0] * op, c[1] * (1 - op) + rgb[1] * op, c[2] * (1 - op) + rgb[2] * op];
}

const hexRgb = (hex: string): Rgb => [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];

/** a `render.js` `FILTERS` tükre (contract-teszt köti) */
export const FILTER_TINTS: Partial<Record<FilterId, { color: string; opacity: number }>> = {
  warm: { color: 'ff9d4d', opacity: 0.18 },
  cool: { color: '4d9dff', opacity: 0.18 },
  mono: { color: '808080', opacity: 0.45 },
  vivid: { color: 'ff2ea6', opacity: 0.1 },
  fade: { color: 'd8d2c2', opacity: 0.25 },
  night: { color: '101040', opacity: 0.35 },
  retro: { color: 'c9a24b', opacity: 0.22 },
  sunset: { color: 'ff6b4a', opacity: 0.2 },
  forest: { color: '2e8b57', opacity: 0.18 },
};

export function adjustOps(a: ClipAdjust | undefined): Op[] {
  if (!a) {
    return [];
  }
  const ops: Op[] = [];
  const brightness = clNum(a.brightness, -0.3, 0.3);
  const contrast = 1 + clNum(a.contrast, -0.4, 0.4);
  const saturation = 1 + clNum(a.saturation, -1, 1);
  const temperature = clNum(a.temperature, -0.3, 0.3);
  const exposure = clNum(a.exposure, -1, 1);
  const highlights = clNum(a.highlights, -1, 1);
  const shadows = clNum(a.shadows, -1, 1);
  const whites = clNum(a.whites, -1, 1);
  const blacks = clNum(a.blacks, -1, 1);
  if (exposure !== 0) {
    const k = Math.pow(2, exposure);
    ops.push((c) => [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)]);
  }
  if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
    ops.push(eqOp(brightness, contrast, saturation));
  }
  if (highlights !== 0 || shadows !== 0 || whites !== 0 || blacks !== 0) {
    const f = splineLut([[0, cl(blacks * 0.15)], [0.25, cl(0.25 + shadows * 0.15)], [0.5, 0.5], [0.75, cl(0.75 + highlights * 0.15)], [1, cl(1 + whites * 0.15)]]);
    ops.push((c) => [f(c[0]), f(c[1]), f(c[2])]);
  }
  if (a.curves) {
    // kézi tónusgörbék: csatornánként, utána a közös (az ffmpeg `curves` sorrendje)
    const curve = (pts: { x: number; y: number }[] | undefined) => {
      if (!pts || pts.length < 2 || pts.every((p) => Math.abs(cl(p.x) - cl(p.y)) < 1e-3)) {
        return null;
      }
      return splineLut(pts.map((p): [number, number] => [cl(p.x), cl(p.y)]).sort((p, q) => p[0] - q[0]));
    };
    const [fr, fg, fb, fa] = [curve(a.curves.red), curve(a.curves.green), curve(a.curves.blue), curve(a.curves.rgb)];
    if (fr || fg || fb || fa) {
      const all = (v: number) => (fa ? fa(v) : v);
      ops.push((c) => [all(fr ? fr(c[0]) : c[0]), all(fg ? fg(c[1]) : c[1]), all(fb ? fb(c[2]) : c[2])]);
    }
  }
  if (temperature !== 0) {
    const m = kelvinRgb(Math.round(Math.min(40000, Math.max(1000, 6500 - temperature * 10000))));
    ops.push((c) => [c[0] * m[0], c[1] * m[1], c[2] * m[2]]);
  }
  const tint = clNum(a.tint, -0.3, 0.3);
  if (tint !== 0) {
    ops.push((c) => [c[0], cl(c[1] * (1 - tint)), c[2]]);
  }
  const vibrance = clNum(a.vibrance, -1, 1);
  if (vibrance !== 0) {
    ops.push(vibranceOp(vibrance));
  }
  const hue = clNum(a.hue, -1, 1);
  const hslSat = clNum(a.hslSaturation, -1, 1);
  const hslLum = clNum(a.hslLuminance, -1, 1);
  if (hue !== 0 || hslSat !== 0 || hslLum !== 0) {
    ops.push(hueOp(hue * 180, 1 + hslSat, hslLum * 3));
  }
  if (a.balance) {
    const b = a.balance;
    const v = (x: number | undefined) => clNum(x, -1, 1) * 0.6;
    ops.push(colorBalanceOp({ rs: v(b.sh?.r), gs: v(b.sh?.g), bs: v(b.sh?.b), rm: v(b.mid?.r), gm: v(b.mid?.g), bm: v(b.mid?.b), rh: v(b.hi?.r), gh: v(b.hi?.g), bh: v(b.hi?.b) }));
  }
  return ops;
}

/** ffmpeg `vibrance`: a kevésbé telített színeket emeli jobban */
function vibranceOp(intensity: number): Op {
  return ([r, g, b]) => {
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const luma = g * 0.715158 + r * 0.212656 + b * 0.072186;
    const k = 1 + intensity * (1 + Math.sign(intensity) * sat);
    return [cl(lerp(luma, r, k)), cl(lerp(luma, g, k)), cl(lerp(luma, b, k))];
  };
}

/** ffmpeg `hue`: az U/V sík forgatása + telítettség + fényerő */
function hueOp(deg: number, sat: number, brightness: number): Op {
  const rad = (deg * Math.PI) / 180;
  const cs = Math.cos(rad) * sat;
  const sn = Math.sin(rad) * sat;
  return (c) => {
    const [y, u, v] = rgbToYuv(c);
    const U = u - 0.5;
    const V = v - 0.5;
    return yuvToRgb([cl(y * ((brightness + 5) / 5) * (brightness ? 1 : 1)), 0.5 + U * cs - V * sn, 0.5 + U * sn + V * cs]);
  };
}

type Balance = Partial<Record<'rs' | 'gs' | 'bs' | 'rm' | 'gm' | 'bm' | 'rh' | 'gh' | 'bh', number>>;

/** ffmpeg `colorbalance`: árnyék / közép / csúcsfény eltolás a világosság szerint */
function colorBalanceOp(p: Balance): Op {
  const part = (v: number, l: number, s = 0, m = 0, h = 0) => {
    const a = 4;
    const b = 0.333;
    const scale = 0.7;
    const clip = (x: number) => Math.max(0, Math.min(1, x));
    const ss = s * clip((b - l) * a + 0.5) * scale;
    const mm = m * clip((l - b) * a + 0.5) * clip((1 - l - b) * a + 0.5) * scale;
    const hh = h * clip((l + b - 1) * a + 0.5) * scale;
    return cl(v + ss + mm + hh);
  };
  return ([r, g, b]) => {
    const l = Math.max(r, g, b) + Math.min(r, g, b);
    return [part(r, l, p.rs, p.rm, p.rh), part(g, l, p.gs, p.gm, p.gh), part(b, l, p.bs, p.bm, p.bh)];
  };
}

/** a `server/grades.js` presetjei: eq + colorbalance (a vignetta térbeli, nincs a LUT-ban) */
export const GRADE_OPS: Partial<Record<GradeId, () => Op[]>> = {
  'teal-orange': () => [eqOp(0, 1.1, 1.08), colorBalanceOp({ rs: -0.12, gs: 0.02, bs: 0.16, rh: 0.16, gh: 0.03, bh: -0.14 })],
  moody: () => [eqOp(-0.04, 1.12, 0.82), colorBalanceOp({ rs: -0.04, bs: 0.12, rm: -0.03, bm: 0.06 })],
  vintage: () => [eqOp(0.03, 0.9, 0.85, 1.06), colorBalanceOp({ rs: 0.1, gs: 0.05, bs: -0.08, rh: 0.1, bh: -0.12 })],
  noir: () => [eqOp(-0.02, 1.25, 0)],
  'warm-film': () => [eqOp(0, 1.06, 1.05), colorBalanceOp({ rm: 0.1, gm: 0.03, bm: -0.12, rh: 0.08, bh: -0.1 })],
  cold: () => [eqOp(0, 1.06, 1), colorBalanceOp({ rm: -0.1, bm: 0.12, rs: -0.06, bs: 0.12, rh: -0.04, bh: 0.06 })],
  vibrant: () => [eqOp(0, 1.12, 1.35, 0.98)],
  dreamy: () => [eqOp(0.05, 0.9, 1.08, 1.05), colorBalanceOp({ rm: 0.06, bm: 0.06, rh: 0.08, bh: 0.04 })],
};

function levelsOp(l: NonNullable<PhotoLayer['levels']>): Op | null {
  const b = Math.max(0, Math.min(0.9, Number(l.black) || 0));
  const w = Math.max(b + 0.05, Math.min(1, l.white != null ? Number(l.white) : 1));
  const g = Math.max(0.1, Math.min(5, Number(l.gamma) || 1));
  if (b === 0 && w === 1 && g === 1) {
    return null;
  }
  const f = (v: number) => Math.pow(cl((v - b) / (w - b)), 1 / g);
  return (c) => [f(c[0]), f(c[1]), f(c[2])];
}

function channelMixOp(m: NonNullable<PhotoLayer['channelMix']>): Op {
  const n = (v: number | undefined, d: number) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
  return ([r, g, b]) => [
    r * n(m.rr, 1) + g * n(m.rg, 0) + b * n(m.rb, 0),
    r * n(m.gr, 0) + g * n(m.gg, 1) + b * n(m.gb, 0),
    r * n(m.br, 0) + g * n(m.bg, 0) + b * n(m.bb, 1),
  ];
}

function gradientMapOp(shadow: string, highlight: string): Op {
  const s = hexRgb(shadow.replace('#', ''));
  const h = hexRgb(highlight.replace('#', ''));
  return ([r, g, b]) => {
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    return [s[0] * (1 - L) + h[0] * L, s[1] * (1 - L) + h[1] * L, s[2] * (1 - L) + h[2] * L];
  };
}

const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

/** a pixelenkénti `filters` (blur/sharpen/zaj/pixeles térbeli, azok máshol) */
function filterOps(filters: PhotoLayer['filters']): Op[] {
  const ops: Op[] = [];
  for (const f of filters ?? []) {
    const a = cl(f.amount ?? 0);
    if (a <= 0) continue;
    if (f.type === 'grayscale') {
      ops.push(hueOp(0, 1 - a, 0));
    } else if (f.type === 'sepia') {
      const m = SEPIA.map((v, i) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] * (1 - a) + v * a);
      ops.push(([r, g, b]) => [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]);
    } else if (f.type === 'dehaze') {
      ops.push(eqOp(0, 1 + a * 0.6, 1 + a * 0.4));
    } else if (f.type === 'posterize') {
      const step = Math.round(8 + a * 120);
      const p = (v: number) => (Math.trunc(Math.round(v * 255) / step) * step) / 255;
      ops.push((c) => [p(c[0]), p(c[1]), p(c[2])]);
    } else if (f.type === 'duotone') {
      const lo = [43, 45, 122];
      const hi = [255, 143, 171];
      const gray = hueOp(0, 0, 0);
      const ch = (v: number, i: number) => v * (1 - a) + ((lo[i] + (hi[i] - lo[i]) * v) / 255) * a;
      ops.push((c) => {
        const [r, g, b] = gray(c);
        return [ch(r, 0), ch(g, 1), ch(b, 2)];
      });
    }
  }
  return ops;
}

/** Egy szín a teljes láncon át. */
export function applyOps(ops: Op[], c: Rgb): Rgb {
  const out = ops.reduce((v, op) => op(v), c);
  return [cl(out[0]), cl(out[1]), cl(out[2])];
}

/** a réteg színmezői; a korrekciós rétegek és a dokumentum ugyanezekből áll */
export type ColorFields = Pick<PhotoLayer, 'adjust' | 'filterId' | 'filterIntensity' | 'grade' | 'gradientMap' | 'levels' | 'channelMix' | 'filters' | 'develop'>;

/** A fotó-réteg teljes színlánca, az `imagedoc.js` sorrendjében. Az `after` a fölötte ható korrekciók. */
export function layerOps(layer: ColorFields, after: ColorFields[] = []): Op[] {
  const ops = adjustOps(layer.adjust);
  ops.push(...(layer.grade ? GRADE_OPS[layer.grade]?.() ?? [] : []));
  const tint = layer.filterId ? FILTER_TINTS[layer.filterId] : undefined;
  if (tint) {
    ops.push(tintOp(hexRgb(tint.color), Math.max(0, Math.min(1, tint.opacity * (layer.filterIntensity ?? 1)))));
  }
  if (layer.gradientMap) {
    ops.push(gradientMapOp(layer.gradientMap.shadow, layer.gradientMap.highlight));
  }
  const lv = layer.levels ? levelsOp(layer.levels) : null;
  if (lv) {
    ops.push(lv);
  }
  if (layer.channelMix) {
    ops.push(channelMixOp(layer.channelMix));
  }
  ops.push(...filterOps(layer.filters));
  ops.push(...adjustOps(layer.develop?.base));
  for (const up of after) {
    // a korrekciós réteg és a dokumentum sorrendje a renderben: grade, utána adjust
    ops.push(...(up.grade ? GRADE_OPS[up.grade]?.() ?? [] : []), ...adjustOps(up.adjust));
  }
  return ops;
}

/**
 * Egy fotó fölött ható korrekciók a vásznon: a fölötte lévő, maszk nélküli korrekciós rétegek,
 * majd a dokumentum-szintű grade. A Skia a nézetek mögé nem lát, ezért a hatást a fotó LUT-jába
 * számoljuk; a nem-fotó rétegek ezeket nem kapják meg.
 */
export function correctionsAbove(doc: { layers: { kind: string; id: string; hidden?: boolean; mask?: unknown; grade?: GradeId; adjust?: ClipAdjust }[]; grade?: GradeId; adjust?: ClipAdjust }, layerId: string): ColorFields[] {
  const i = doc.layers.findIndex((l) => l.id === layerId);
  const above = doc.layers.slice(i + 1).filter((l) => l.kind === 'adjust' && !l.hidden && !l.mask) as ColorFields[];
  return doc.grade || doc.adjust ? [...above, { grade: doc.grade, adjust: doc.adjust }] : above;
}

export { lerp };
