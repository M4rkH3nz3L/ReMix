/**
 * 🎨 Skia preview-hűség mag (VIDEO 01.2 / 03.1 — a „vak szerkesztés" feloldása).
 *
 * A szín-grade (`ClipAdjust`) és az effekt-lánc (`VideoEffect[]`) egy részét a
 * RENDER teljes FFmpeg-filtergraphhal égeti be, az ELŐNÉZET viszont eddig csak
 * féligátlátszó CSS-tinttel közelítette (`adjustPreview.ts`) — a curves/LUT/
 * effektek a vásznon NEM látszottak. Ez a mag a grade + a szín-effektek egy
 * részét egy **Skia 4×5 ColorMatrix**-ba (`number[20]`) és **ImageFilter-leíróba**
 * (blur/sharpen) fordítja, amit a Skia preview-réteg a klip-kockára tesz.
 *
 * PURE / Skia-mentes: csak szám-matek + sima leírók (nincs @shopify/react-native-skia
 * import) → önmagában unit-tesztelhető, eszköz nélkül. A preview-réteg a
 * `number[20]`-at Skia `ColorMatrix`-szá, a leírókat `ImageFilter`-ré alakítja.
 *
 * ⚠️ VIZUÁLIS KÖZELÍTÉS: a cél a hű előnézet, NEM a bitre-azonos render-paritás
 * (a Skia ColorMatrix ≠ FFmpeg eq/curves pixelre). A régió-szelektív/nem-lineáris
 * hatások (highlights/shadows/whites/blacks görbe, LUT, vignette, grain, scanlines,
 * halftone, chromaticAberration, lightLeak) `render-only`-k maradnak → a UI jelzi.
 */

import type { ClipAdjust, VideoEffect, VideoEffectType } from '@/types/project';

/** Rec.709 luminancia-együtthatók (szaturáció-mátrixhoz). */
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/** 4×5 egységmátrix (sor-folytonos, 20 elem): a kimenet = a bemenet. */
export const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * Két 4×5 szín-mátrix kompozíciója: ELŐSZÖR `a`, UTÁNA `b` (mintha 5×5-ös
 * affin transzformok lennének, alsó sor [0,0,0,0,1]). Eredmény = b ∘ a.
 */
export function composeMatrix(a: number[], b: number[]): number[] {
  // 5×5-re egészítjük (az 5. sor fix), szorzunk, majd az első 4 sort visszaadjuk.
  const A = to5x5(a);
  const B = to5x5(b);
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let sum = 0;
      for (let k = 0; k < 5; k++) {
        sum += B[r * 5 + k] * A[k * 5 + c];
      }
      out.push(sum);
    }
  }
  return out;
}

/** Több mátrix kompozíciója balról jobbra (az első alkalmazódik előbb). */
export function composeAll(matrices: number[][]): number[] {
  return matrices.reduce((acc, m) => composeMatrix(acc, m), IDENTITY_MATRIX);
}

function to5x5(m: number[]): number[] {
  return [...m.slice(0, 20), 0, 0, 0, 0, 1];
}

// ── alap szín-mátrixok (0…1 normalizált csatornákra; az eltolás-oszlop 0…1) ──

/** Fényerő: additív eltolás az RGB-n (`b` 0…1 skálán). */
export function brightnessMatrix(b: number): number[] {
  return [1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];
}

/** Expozíció (stop): RGB szorzás 2^stops-szal. */
export function exposureMatrix(stops: number): number[] {
  const g = Math.pow(2, stops);
  return [g, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, 1, 0];
}

/** Kontraszt a 0.5 középpont körül (`c` = szorzó, 1 = alap). */
export function contrastMatrix(c: number): number[] {
  const o = 0.5 * (1 - c);
  return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
}

/** Szaturáció (`s` = 0 szürke, 1 alap, >1 élénkebb), luminancia-megőrző. */
export function saturationMatrix(s: number): number[] {
  const a = 1 - s;
  return [
    LR * a + s, LG * a, LB * a, 0, 0,
    LR * a, LG * a + s, LB * a, 0, 0,
    LR * a, LG * a, LB * a + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Hőmérséklet: meleg (+) → R fel, B le; hideg (−) → fordítva. `t` ~ -0.3…0.3. */
export function temperatureMatrix(t: number): number[] {
  const k = t * 0.5;
  return [1 + k, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1 - k, 0, 0, 0, 0, 0, 1, 0];
}

/** Tint: magenta (+) → R,B fel / G le; zöld (−) → fordítva. `t` ~ -0.3…0.3. */
export function tintMatrix(t: number): number[] {
  const k = t * 0.5;
  return [1 + k * 0.5, 0, 0, 0, 0, 0, 1 - k, 0, 0, 0, 0, 0, 1 + k * 0.5, 0, 0, 0, 0, 0, 1, 0];
}

/** Színforgatás fokban (hue rotate) — standard YIQ-alapú közelítés. */
export function hueRotateMatrix(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // standard hue-rotation (a böngésző `feColorMatrix type=hueRotate`-jével azonos)
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0, 0,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283, 0, 0,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Negatív (invert). */
export function invertMatrix(): number[] {
  return [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];
}

/** Szépia (klasszikus). */
export function sepiaMatrix(): number[] {
  return [
    0.393, 0.769, 0.189, 0, 0,
    0.349, 0.686, 0.168, 0, 0,
    0.272, 0.534, 0.131, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Szürkeárnyalatos (szaturáció 0). */
export function grayscaleMatrix(): number[] {
  return saturationMatrix(0);
}

// ── grade (ColorMatrix-ra képezhető rész) ───────────────────────────────────

/**
 * A `ClipAdjust` ColorMatrix-ra képezhető mezőiből összetett 4×5 mátrix (a többi
 * — highlights/shadows/whites/blacks görbe, LUT, vignette, splitTone, gradientMap,
 * levels, curves — `render-only`, nem kerül ide). A sorrend a render-lánc szellemét
 * követi: expozíció → fényerő → kontraszt → hőmérséklet/tint → szaturáció → hue.
 */
export function gradeColorMatrix(adjust: ClipAdjust | undefined): number[] {
  if (!adjust) {
    return IDENTITY_MATRIX;
  }
  const chain: number[][] = [];
  if (adjust.exposure) {
    chain.push(exposureMatrix(adjust.exposure));
  }
  if (adjust.brightness) {
    chain.push(brightnessMatrix(adjust.brightness));
  }
  if (adjust.contrast) {
    chain.push(contrastMatrix(1 + adjust.contrast));
  }
  if (adjust.temperature) {
    chain.push(temperatureMatrix(adjust.temperature));
  }
  if (adjust.tint) {
    chain.push(tintMatrix(adjust.tint));
  }
  // Basic saturation (−1…1 → 0…2) + HSL-telítettség (additív a szorzóhoz)
  const satBase = (adjust.saturation ?? 0) + (adjust.hslSaturation ?? 0);
  if (satBase !== 0) {
    chain.push(saturationMatrix(Math.max(0, 1 + satBase)));
  }
  if (adjust.hue) {
    chain.push(hueRotateMatrix(adjust.hue * 180));
  }
  return chain.length ? composeAll(chain) : IDENTITY_MATRIX;
}

// ── effekt-lánc (ColorMatrix-ra képezhető rész) ──────────────────────────────

/** Mely effektek képződnek Skia-preview-ra, és hogyan (a UI „render-only" jelzéshez is). */
export const EFFECT_PREVIEW_SUPPORT: Record<VideoEffectType, 'colorMatrix' | 'blur' | 'sharpen' | 'render-only'> = {
  grayscale: 'colorMatrix',
  sepia: 'colorMatrix',
  invert: 'colorMatrix',
  blur: 'blur',
  sharpen: 'sharpen',
  // nem-lineáris / textúra / régió-szelektív → a renderben ég be
  vignette: 'render-only',
  grain: 'render-only',
  chromaticAberration: 'render-only',
  lightLeak: 'render-only',
  motionBlur: 'render-only',
  deflicker: 'render-only',
  clarity: 'render-only',
  dehaze: 'render-only',
  pixelate: 'render-only',
  posterize: 'render-only',
  scanlines: 'render-only',
  halftone: 'render-only',
};

/** Aktív-e az effekt (a lánc `enabled !== false` elemei). */
function isOn(fx: VideoEffect): boolean {
  return fx.enabled !== false;
}

/**
 * Az effekt-lánc ColorMatrix-ra képezhető (grayscale/sepia/invert) elemeiből
 * összetett mátrix, a lánc SORRENDJÉBEN (a render is sorrend-függő).
 */
export function effectColorMatrix(effects: VideoEffect[] | undefined): number[] {
  if (!effects?.length) {
    return IDENTITY_MATRIX;
  }
  const chain: number[][] = [];
  for (const fx of effects) {
    if (!isOn(fx)) {
      continue;
    }
    if (fx.type === 'grayscale') {
      chain.push(grayscaleMatrix());
    } else if (fx.type === 'sepia') {
      chain.push(sepiaMatrix());
    } else if (fx.type === 'invert') {
      chain.push(invertMatrix());
    }
  }
  return chain.length ? composeAll(chain) : IDENTITY_MATRIX;
}

/**
 * A klip TELJES preview-ColorMatrixa: előbb a grade, utána az effekt-lánc szín-
 * elemei (a render-lánc szellemében: megjelenés-lánc UTÁN az effektek).
 */
export function clipColorMatrix(
  adjust: ClipAdjust | undefined,
  effects: VideoEffect[] | undefined
): number[] {
  return composeMatrix(gradeColorMatrix(adjust), effectColorMatrix(effects));
}

/** Identitás-e a mátrix (⇒ a preview-réteg kihagyhatja a ColorMatrix-paintet). */
export function isIdentityMatrix(m: number[], eps = 1e-4): boolean {
  if (m.length !== IDENTITY_MATRIX.length) {
    return false;
  }
  for (let i = 0; i < m.length; i++) {
    if (Math.abs(m[i] - IDENTITY_MATRIX[i]) > eps) {
      return false;
    }
  }
  return true;
}

// ── ImageFilter-leírók (blur / sharpen) ──────────────────────────────────────

/** A preview-réteg ImageFilter-leírója (Skia-mentes; a réteg Skia-objektummá alakítja). */
export interface PreviewImageFilter {
  kind: 'blur' | 'sharpen';
  /** blur: Gauss-sigma px; sharpen: él-kiemelés erőssége 0…1 */
  amount: number;
}

/**
 * Az effekt-láncból a blur/sharpen leírók (a `box`-méretre skálázva a blur-sigma).
 * A többi effekt (lásd EFFECT_PREVIEW_SUPPORT) nem ad ImageFiltert.
 */
export function effectImageFilters(
  effects: VideoEffect[] | undefined,
  box: { w: number; h: number }
): PreviewImageFilter[] {
  if (!effects?.length) {
    return [];
  }
  const out: PreviewImageFilter[] = [];
  const unit = Math.max(box.w, box.h) || 1;
  for (const fx of effects) {
    if (!isOn(fx)) {
      continue;
    }
    const amt = fx.amount ?? 0.5;
    if (fx.type === 'blur') {
      // a sigma a klip-mérethez skálázva (max ~3% a hosszabb oldalból)
      out.push({ kind: 'blur', amount: amt * unit * 0.03 });
    } else if (fx.type === 'sharpen') {
      out.push({ kind: 'sharpen', amount: amt });
    }
  }
  return out;
}
