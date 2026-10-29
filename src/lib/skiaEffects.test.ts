import {
  skiaUncoveredAdjust,
  EFFECT_PREVIEW_SUPPORT,
  IDENTITY_MATRIX,
  clipColorMatrix,
  composeMatrix,
  effectColorMatrix,
  effectImageFilters,
  gradeColorMatrix,
  grayscaleMatrix,
  invertMatrix,
  isIdentityMatrix,
  saturationMatrix,
} from '@/lib/skiaEffects';
import { VIDEO_EFFECT_TYPES } from '@/lib/videoEffects';
import type { VideoEffect } from '@/types/project';

/** 4×5 mátrix alkalmazása egy [r,g,b,a] színre (0…1). */
function apply(m: number[], [r, g, b, a]: number[]): number[] {
  return [
    m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4],
    m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9],
    m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14],
    m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19],
  ];
}

const fx = (type: VideoEffect['type'], extra: Partial<VideoEffect> = {}): VideoEffect => ({
  id: `fx_${type}`,
  type,
  ...extra,
});

describe('skiaEffects — mátrix-alapok', () => {
  it('IDENTITY változatlanul hagyja a színt', () => {
    expect(apply(IDENTITY_MATRIX, [0.2, 0.4, 0.6, 1])).toEqual([0.2, 0.4, 0.6, 1]);
    expect(isIdentityMatrix(IDENTITY_MATRIX)).toBe(true);
  });

  it('composeMatrix identitással no-op (mindkét oldalról)', () => {
    const inv = invertMatrix();
    expect(composeMatrix(IDENTITY_MATRIX, inv)).toEqual(inv);
    expect(composeMatrix(inv, IDENTITY_MATRIX)).toEqual(inv);
  });

  it('invert negálja az RGB-t, az alfát tartja', () => {
    const [r, g, b, a] = apply(invertMatrix(), [0.2, 0.4, 0.6, 1]);
    expect(r).toBeCloseTo(0.8);
    expect(g).toBeCloseTo(0.6);
    expect(b).toBeCloseTo(0.4);
    expect(a).toBeCloseTo(1);
  });

  it('grayscale azonos R=G=B luminanciát ad', () => {
    const [r, g, b] = apply(grayscaleMatrix(), [0.2, 0.5, 0.9, 1]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
    // a luma a Rec.709 súlyokkal
    expect(r).toBeCloseTo(0.2126 * 0.2 + 0.7152 * 0.5 + 0.0722 * 0.9);
  });

  it('saturationMatrix(1) = identitás (nincs változás)', () => {
    expect(isIdentityMatrix(saturationMatrix(1))).toBe(true);
  });

  it('dupla invert visszaadja az eredetit (kompozíció helyes)', () => {
    const twice = composeMatrix(invertMatrix(), invertMatrix());
    const [r, g, b] = apply(twice, [0.2, 0.4, 0.6, 1]);
    expect(r).toBeCloseTo(0.2);
    expect(g).toBeCloseTo(0.4);
    expect(b).toBeCloseTo(0.6);
  });
});

describe('skiaEffects — grade', () => {
  it('üres/undefined grade → identitás', () => {
    expect(isIdentityMatrix(gradeColorMatrix(undefined))).toBe(true);
    expect(isIdentityMatrix(gradeColorMatrix({}))).toBe(true);
  });

  it('saturation=-1 → szürkeárnyalat (R=G=B)', () => {
    const m = gradeColorMatrix({ saturation: -1 });
    const [r, g, b] = apply(m, [0.2, 0.5, 0.9, 1]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it('brightness>0 világosít (RGB nő)', () => {
    const m = gradeColorMatrix({ brightness: 0.2 });
    const [r] = apply(m, [0.3, 0.3, 0.3, 1]);
    expect(r).toBeCloseTo(0.5);
  });

  it('exposure szoroz (2^stops)', () => {
    const m = gradeColorMatrix({ exposure: 1 }); // 2×
    const [r] = apply(m, [0.25, 0.25, 0.25, 1]);
    expect(r).toBeCloseTo(0.5);
  });
});

describe('skiaEffects — effekt-lánc', () => {
  it('üres lánc → identitás', () => {
    expect(isIdentityMatrix(effectColorMatrix(undefined))).toBe(true);
    expect(isIdentityMatrix(effectColorMatrix([]))).toBe(true);
  });

  it('grayscale effekt szürkít', () => {
    const [r, g, b] = apply(effectColorMatrix([fx('grayscale')]), [0.2, 0.5, 0.9, 1]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it('kikapcsolt effekt (enabled:false) nem hat', () => {
    expect(isIdentityMatrix(effectColorMatrix([fx('invert', { enabled: false })]))).toBe(true);
  });

  it('clipColorMatrix a grade-et ÉS az effektet komponálja', () => {
    // grayscale grade + invert effekt → előbb szürke, utána negál
    const m = clipColorMatrix({ saturation: -1 }, [fx('invert')]);
    const [r, g, b] = apply(m, [0.2, 0.5, 0.9, 1]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
    const luma = 0.2126 * 0.2 + 0.7152 * 0.5 + 0.0722 * 0.9;
    expect(r).toBeCloseTo(1 - luma); // negált szürke
  });
});

describe('skiaEffects — ImageFilter-leírók + támogatás-tábla', () => {
  it('blur effekt → blur-leíró pozitív sigmával; sharpen → sharpen', () => {
    const filters = effectImageFilters([fx('blur', { amount: 0.5 }), fx('sharpen', { amount: 0.8 })], {
      w: 1000,
      h: 500,
    });
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatchObject({ kind: 'blur' });
    expect(filters[0].amount).toBeGreaterThan(0);
    expect(filters[1]).toMatchObject({ kind: 'sharpen', amount: 0.8 });
  });

  it('EFFECT_PREVIEW_SUPPORT mind a 17 effekt-típust lefedi', () => {
    for (const type of VIDEO_EFFECT_TYPES) {
      expect(EFFECT_PREVIEW_SUPPORT[type]).toBeDefined();
    }
    expect(Object.keys(EFFECT_PREVIEW_SUPPORT).sort()).toEqual([...VIDEO_EFFECT_TYPES].sort());
  });

  it('a szín-effektek colorMatrix-, a blur/sharpen filter-, a többi render-only', () => {
    expect(EFFECT_PREVIEW_SUPPORT.grayscale).toBe('colorMatrix');
    expect(EFFECT_PREVIEW_SUPPORT.sepia).toBe('colorMatrix');
    expect(EFFECT_PREVIEW_SUPPORT.invert).toBe('colorMatrix');
    expect(EFFECT_PREVIEW_SUPPORT.blur).toBe('blur');
    // B20: a Skia nem élesít → render-only jelvény (nem félrevezető „preview-támogatott")
    expect(EFFECT_PREVIEW_SUPPORT.sharpen).toBe('render-only');
    expect(EFFECT_PREVIEW_SUPPORT.vignette).toBe('render-only');
    expect(EFFECT_PREVIEW_SUPPORT.scanlines).toBe('render-only');
  });
});

describe('skiaUncoveredAdjust (B21)', () => {
  it('a mátrixos mezők kiesnek, a tónus/balance megmarad; csak mátrixos → undefined', () => {
    expect(skiaUncoveredAdjust({ brightness: 0.2, saturation: -0.3 })).toBeUndefined();
    expect(skiaUncoveredAdjust({ brightness: 0.2, shadows: 0.4 })).toEqual({ shadows: 0.4 });
    const bal = { mid: { r: 0.2, g: 0, b: 0 } };
    expect(skiaUncoveredAdjust({ contrast: 0.1, balance: bal })).toEqual({ balance: bal });
  });
});
