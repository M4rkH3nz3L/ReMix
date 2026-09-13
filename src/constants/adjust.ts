/** A ClipAdjust NUMERIKUS (stepper-rel állítható) mezői — a `curves` külön UI. */
export type AdjustKey =
  | 'exposure'
  | 'brightness'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'hue'
  | 'hslSaturation'
  | 'hslLuminance'
  | 'vignette';

export interface AdjustField {
  key: AdjustKey;
  step: number;
  min: number;
  max: number;
}

/** Egy-egy Basic-grade vezérlő lépésköze/tartománya (közös a grade-réteg és a
 *  per-klip képjavítás között). Az érték kijelzése mindenhol `érték×100`. */
export const ADJUST_META: Record<AdjustKey, { step: number; min: number; max: number }> = {
  exposure: { step: 0.05, min: -1, max: 1 },
  brightness: { step: 0.05, min: -0.3, max: 0.3 },
  contrast: { step: 0.05, min: -0.4, max: 0.4 },
  highlights: { step: 0.05, min: -1, max: 1 },
  shadows: { step: 0.05, min: -1, max: 1 },
  whites: { step: 0.05, min: -1, max: 1 },
  blacks: { step: 0.05, min: -1, max: 1 },
  temperature: { step: 0.05, min: -0.3, max: 0.3 },
  tint: { step: 0.05, min: -0.3, max: 0.3 },
  saturation: { step: 0.1, min: -1, max: 1 },
  vibrance: { step: 0.05, min: -1, max: 1 },
  hue: { step: 0.05, min: -1, max: 1 },
  hslSaturation: { step: 0.05, min: -1, max: 1 },
  hslLuminance: { step: 0.05, min: -1, max: 1 },
  vignette: { step: 0.1, min: 0, max: 1 },
};

/** Pro Basic-grade a Lightroom-mintát követő csoportokban. */
export const ADJUST_GROUPS: { id: 'tone' | 'color' | 'hsl' | 'effect'; keys: AdjustKey[] }[] = [
  { id: 'tone', keys: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'color', keys: ['temperature', 'tint', 'saturation', 'vibrance'] },
  { id: 'hsl', keys: ['hue', 'hslSaturation', 'hslLuminance'] },
  { id: 'effect', keys: ['vignette'] },
];

/** Lapos lista (neutral-ellenőrzéshez és a per-klip panel egyszerű bejárásához). */
export const ADJUST_FIELDS: AdjustField[] = ADJUST_GROUPS.flatMap((g) =>
  g.keys.map((key) => ({ key, ...ADJUST_META[key] }))
);
