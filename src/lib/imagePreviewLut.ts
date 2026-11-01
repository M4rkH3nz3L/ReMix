import { applyOps, type ColorFields, GRADE_VIGNETTE, layerOps, type Rgb } from '@/lib/imagePixelPipeline';
import type { CubeLut } from '@/lib/lutImport';
import type { PhotoLayer } from '@/types/project';

/**
 * 🧊 Az előnézet 3D LUT-ja: a réteg színlánca 25×25×25 rácspontra számolva, 2D-atlaszban
 * (`LUT_SIZE` magas sor, kék szerint `LUT_SIZE` szelet egymás mellett). A Skia-shader ebből
 * interpolál, így a nemlineáris műveletek (görbe, vibrance, hue) is az export színét adják.
 */
export const LUT_SIZE = 25;

/** húzás közbeni, gyors rács: megállás után a pontos `LUT_SIZE` váltja */
export const LUT_DRAFT_SIZE = 13;

/** Van-e a rétegen pixelenkénti színművelet? */
export function hasColorOps(layer: ColorFields, after: ColorFields[] = [], cube?: CubeLut | null): boolean {
  return layerOps(layer, after, cube).length > 0;
}

/** RGBA bájtok: szélesség `LUT_SIZE²`, magasság `LUT_SIZE`. */
export function buildLutBytes(layer: ColorFields, after: ColorFields[] = [], n = LUT_SIZE, cube?: CubeLut | null): Uint8Array {
  const ops = layerOps(layer, after, cube);
  const max = n - 1;
  const out = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let g = 0; g < n; g++) {
    for (let b = 0; b < n; b++) {
      for (let r = 0; r < n; r++) {
        const c = applyOps(ops, [r / max, g / max, b / max]);
        out[o++] = Math.round(c[0] * 255);
        out[o++] = Math.round(c[1] * 255);
        out[o++] = Math.round(c[2] * 255);
        out[o++] = 255;
      }
    }
  }
  return out;
}

/** A shader számításának mása (teszthez): háromszorosan lineáris olvasás az atlaszból. */
export function sampleLut(bytes: Uint8Array, c: Rgb, n = LUT_SIZE): Rgb {
  const max = n - 1;
  const at = (r: number, g: number, b: number, ch: number) => bytes[(g * n * n + b * n + r) * 4 + ch] / 255;
  const f = (v: number) => {
    const p = Math.min(max, Math.max(0, v * max));
    const i = Math.min(max - 1, Math.floor(p));
    return [i, p - i] as const;
  };
  const [r0, rt] = f(c[0]);
  const [g0, gt] = f(c[1]);
  const [b0, bt] = f(c[2]);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const ch = (k: number) => {
    const sl = (b: number) => mix(mix(at(r0, g0, b, k), at(r0 + 1, g0, b, k), rt), mix(at(r0, g0 + 1, b, k), at(r0 + 1, g0 + 1, b, k), rt), gt);
    return mix(sl(b0), sl(b0 + 1), bt);
  };
  return [ch(0), ch(1), ch(2)];
}

/** A réteg térbeli műveletei a shader-paraméterekként (képernyő-pontban). */
export interface LayerDetail {
  /** 5×5-ös élesítés: az `unsharp` lx=5 erőssége */
  sharp: number;
  /** nagy sugarú mikrokontraszt: az `unsharp` lx=13 erőssége */
  clarity: number;
  /** a blokk mérete (0 = nincs pixelezés) */
  block: number;
  /** zaj amplitúdó 0–1 */
  noise: number;
  /** vignetta szögek (a render `vignette` szűrői) */
  vignette: [number, number, number];
  /** folt-javítás téglalapok (box-lokális), legfeljebb 4 */
  heal: [number, number, number, number][];
  scale: number;
}

/** A szűrők, develop-részletek és a folt-javítás lefordítása a shader paramétereire. */
export function layerDetail(layer: Pick<PhotoLayer, 'filters' | 'develop' | 'grade' | 'adjust' | 'heal'>, scale: number): LayerDetail {
  const d = layer.develop?.detail ?? {};
  const amount = (type: string) => Math.max(0, Math.min(1, layer.filters?.find((f) => f.type === type)?.amount ?? 0));
  const adjV = Math.max(0, Math.min(1, Number(layer.adjust?.vignette ?? layer.develop?.base?.vignette) || 0));
  const gradeV = layer.grade ? GRADE_VIGNETTE[layer.grade] ?? 0 : 0;
  const fx = amount('vignette');
  const pix = amount('pixelate');
  return {
    sharp: amount('sharpen') * 2 + (d.sharpness ?? 0) * 2 + (d.texture ?? 0) * 1.2,
    clarity: amount('clarity') * 1.5 + (d.clarity ?? 0) * 1.5,
    block: pix > 0 ? (2 + Math.round(pix * 22)) * scale : 0,
    noise: (Math.max(amount('noise'), amount('grain')) * 40) / 255,
    vignette: [adjV * (Math.PI / 4), gradeV, fx > 0 ? 0.1 + fx * 1.1 : 0],
    heal: (layer.heal ?? []).slice(0, 4).map((r) => [r.x, r.y, r.w, r.h]),
    scale,
  };
}

/** Van-e térbeli művelet? (a detail-shader akkor is kell, ha nincs színlánc) */
export function hasDetail(d: LayerDetail): boolean {
  return d.sharp !== 0 || d.clarity !== 0 || d.block > 0 || d.noise > 0 || d.vignette[0] > 0 || d.vignette[1] > 0 || d.vignette[2] > 0 || d.heal.length > 0;
}

/**
 * SkSL: forrás (pixelezés, folt-javítás) → élesítés → 3D LUT (a kék szeletek közt keverve) →
 * vignetta, zaj. A `lut` lineáris szűréssel; a koordináták pontban, a doboz mérete `box`.
 */
export const LUT_SHADER = `
uniform shader image;
uniform shader lut;
uniform float size;
uniform float2 box;
uniform float block;
uniform float sharp;
uniform float clarity;
uniform float stride;
uniform float noise;
uniform float3 vign;
uniform float healCount;
uniform float4 heal0;
uniform float4 heal1;
uniform float4 heal2;
uniform float4 heal3;

half4 healAt(float2 p, float4 r) {
  float2 o = r.xy * box;
  float2 s = r.zw * box;
  float2 t = clamp((p - o) / s, 0.0, 1.0);
  half4 l = image.eval(float2(o.x - 1.0, p.y));
  half4 e = image.eval(float2(o.x + s.x + 1.0, p.y));
  half4 u = image.eval(float2(p.x, o.y - 1.0));
  half4 d = image.eval(float2(p.x, o.y + s.y + 1.0));
  return (mix(l, e, half(t.x)) + mix(u, d, half(t.y))) * 0.5;
}
bool inside(float2 p, float4 r) {
  float2 q = (p - r.xy * box) / (r.zw * box);
  return q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0;
}
half4 healed(float2 p) {
  if (healCount > 0.5 && inside(p, heal0)) { return healAt(p, heal0); }
  if (healCount > 1.5 && inside(p, heal1)) { return healAt(p, heal1); }
  if (healCount > 2.5 && inside(p, heal2)) { return healAt(p, heal2); }
  if (healCount > 3.5 && inside(p, heal3)) { return healAt(p, heal3); }
  return image.eval(p);
}
half4 src(float2 xy) {
  if (block <= 0.0) { return healed(xy); }
  // a pixelize a blokk ÁTLAGA: egyenletes 4×4 minta a blokkon belül
  float2 o = floor(xy / block) * block;
  half4 sum = half4(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      sum += healed(o + (float2(float(i), float(j)) + 0.5) * block * 0.25);
    }
  }
  return sum / 16.0;
}
float luma(half4 c) { return 0.299 * float(c.r) + 0.587 * float(c.g) + 0.114 * float(c.b); }
float binomial(float2 xy, float s) {
  float sum = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      float wi = i == 0 ? 6.0 : (i == 1 || i == -1) ? 4.0 : 1.0;
      float wj = j == 0 ? 6.0 : (j == 1 || j == -1) ? 4.0 : 1.0;
      sum += wi * wj * luma(src(xy + float2(float(i), float(j)) * s));
    }
  }
  return sum / 256.0;
}
float rnd(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }
half4 main(float2 xy) {
  half4 c = src(xy);
  if (c.a <= 0.0) { return c; }
  float3 rgb = float3(c.rgb) / float(c.a);
  float y = luma(half4(half3(rgb), 1.0));
  float delta = 0.0;
  if (sharp != 0.0) { delta += sharp * (luma(c) - binomial(xy, stride)); }
  // a 13-as binomiális szórása 5-ös kernelen √3-szoros lépésközzel adható vissza
  if (clarity != 0.0) { delta += clarity * (luma(c) - binomial(xy, stride * 1.732)); }
  rgb = clamp(rgb + delta, 0.0, 1.0);
  float m = size - 1.0;
  float b = rgb.b * m;
  float b0 = min(floor(b), m - 1.0);
  float t = b - b0;
  float2 p = float2(rgb.r * m + 0.5, rgb.g * m + 0.5);
  float3 lo = float3(lut.eval(float2(p.x + b0 * size, p.y)).rgb);
  float3 hi = float3(lut.eval(float2(p.x + (b0 + 1.0) * size, p.y)).rgb);
  float3 o = mix(lo, hi, t);
  float d = length(xy - box * 0.5) / length(box * 0.5);
  if (vign.x > 0.0) { float k = cos(vign.x * d); o *= k * k * k * k; }
  if (vign.y > 0.0) { float k = cos(vign.y * d); o *= k * k * k * k; }
  if (vign.z > 0.0) { float k = cos(vign.z * d); o *= k * k * k * k; }
  if (noise > 0.0) { o += (rnd(xy) - 0.5) * noise; }
  return half4(half3(clamp(o, 0.0, 1.0)) * c.a, c.a);
}`;
