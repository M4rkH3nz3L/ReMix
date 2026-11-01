import { applyOps, type ColorFields, layerOps, type Rgb } from '@/lib/imagePixelPipeline';

/**
 * 🧊 Az előnézet 3D LUT-ja: a réteg színlánca 25×25×25 rácspontra számolva, 2D-atlaszban
 * (`LUT_SIZE` magas sor, kék szerint `LUT_SIZE` szelet egymás mellett). A Skia-shader ebből
 * interpolál, így a nemlineáris műveletek (görbe, vibrance, hue) is az export színét adják.
 */
export const LUT_SIZE = 25;

/** húzás közbeni, gyors rács: megállás után a pontos `LUT_SIZE` váltja */
export const LUT_DRAFT_SIZE = 13;

/** Van-e a rétegen pixelenkénti színművelet? */
export function hasColorOps(layer: ColorFields, after: ColorFields[] = []): boolean {
  return layerOps(layer, after).length > 0;
}

/** RGBA bájtok: szélesség `LUT_SIZE²`, magasság `LUT_SIZE`. */
export function buildLutBytes(layer: ColorFields, after: ColorFields[] = [], n = LUT_SIZE): Uint8Array {
  const ops = layerOps(layer, after);
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

/** SkSL: az atlasz-olvasás a shaderben. `lut` lineáris szűréssel, a kék szeletek közt keverünk. */
export const LUT_SHADER = `
uniform shader image;
uniform shader lut;
uniform float size;
half4 main(float2 xy) {
  half4 c = image.eval(xy);
  if (c.a <= 0.0) { return c; }
  float3 rgb = float3(c.rgb) / float(c.a);
  float m = size - 1.0;
  float b = clamp(rgb.b, 0.0, 1.0) * m;
  float b0 = min(floor(b), m - 1.0);
  float t = b - b0;
  float2 p = float2(clamp(rgb.r, 0.0, 1.0) * m + 0.5, clamp(rgb.g, 0.0, 1.0) * m + 0.5);
  float3 lo = float3(lut.eval(float2(p.x + b0 * size, p.y)).rgb);
  float3 hi = float3(lut.eval(float2(p.x + (b0 + 1.0) * size, p.y)).rgb);
  float3 o = mix(lo, hi, t);
  return half4(half3(o) * c.a, c.a);
}`;
