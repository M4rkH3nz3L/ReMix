import { createAdjustment, flattenAdjustments } from '@/lib/adjustmentStack';
import { isNeutralHsl } from '@/lib/hslBands';
import type { AdjustmentKind, AdjustmentLayer, ClipAdjust, HslBands, PhotoLayer } from '@/types/project';

/**
 * 🎞️ Look-könyvtár (IMAGE-PROD S17 „presetek bővítése”) — pure. Egy look NEM beégetett szűrő, hanem a
 * fotó korrekciós vermének és színenkénti HSL-jének kész beállítása: egy koppintással felkerül, utána
 * minden lépése külön állítható, kikapcsolható (ugyanaz a verem, mint kézzel). A render mindkét úton a
 * már mért láncon fut (verem → `adjust`, HSL → LUT / `.cube`). Saját look a telefonon menthető.
 */

export interface LookStep {
  kind: AdjustmentKind;
  adjust: ClipAdjust;
  /** a lépés neve a veremben (fordítási kulcs a beépítettnél, szöveg a sajátnál) */
  name: string;
}

export interface ImageLook {
  key: string;
  /** a beépített look fordítási kulcsa, a saját look neve */
  name: string;
  steps: LookStep[];
  hsl?: HslBands;
  /** saját (a telefonon mentett) look */
  custom?: boolean;
}

const k = (key: string) => `studio.image.looks.step.${key}`;

/** a beépített lookok — mind a verem meglévő mezőiből (expozíció, tónus, fehéregyensúly, színegyensúly…) */
export const IMAGE_LOOKS: ImageLook[] = [
  {
    key: 'portrait',
    name: 'studio.image.looks.portrait',
    steps: [
      { kind: 'custom', name: k('tone'), adjust: { highlights: -0.15, shadows: 0.2 } },
      { kind: 'whiteBalance', name: k('warm'), adjust: { temperature: 0.06 } },
      { kind: 'vibrance', name: k('vibrance'), adjust: { vibrance: 0.15 } },
    ],
    hsl: { orange: { s: -0.1, l: 0.1 }, red: { s: -0.05 } },
  },
  {
    key: 'food',
    name: 'studio.image.looks.food',
    steps: [
      { kind: 'exposure', name: k('exposure'), adjust: { exposure: 0.08 } },
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: 0.1 } },
      { kind: 'vibrance', name: k('vibrance'), adjust: { vibrance: 0.35 } },
      { kind: 'whiteBalance', name: k('warm'), adjust: { temperature: 0.05 } },
    ],
    hsl: { yellow: { s: 0.15 }, green: { s: 0.1 } },
  },
  {
    key: 'landscape',
    name: 'studio.image.looks.landscape',
    steps: [
      { kind: 'custom', name: k('tone'), adjust: { highlights: -0.3, shadows: 0.15, whites: 0.1, blacks: -0.1 } },
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: 0.15 } },
      { kind: 'vibrance', name: k('vibrance'), adjust: { vibrance: 0.3 } },
    ],
    hsl: { blue: { s: 0.2, l: -0.15 }, green: { s: 0.15 }, aqua: { s: 0.15 } },
  },
  {
    key: 'bwContrast',
    name: 'studio.image.looks.bwContrast',
    steps: [
      { kind: 'saturation', name: k('mono'), adjust: { saturation: -1 } },
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: 0.3 } },
      { kind: 'custom', name: k('tone'), adjust: { whites: 0.15, blacks: -0.2 } },
    ],
  },
  {
    key: 'matte',
    name: 'studio.image.looks.matte',
    steps: [
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: -0.15 } },
      { kind: 'custom', name: k('tone'), adjust: { blacks: 0.25, whites: -0.1 } },
      { kind: 'saturation', name: k('saturation'), adjust: { saturation: -0.2 } },
    ],
  },
  {
    key: 'sunny',
    name: 'studio.image.looks.sunny',
    steps: [
      { kind: 'exposure', name: k('exposure'), adjust: { exposure: 0.1 } },
      { kind: 'whiteBalance', name: k('warm'), adjust: { temperature: 0.15, tint: 0.03 } },
      { kind: 'colorBalance', name: k('balance'), adjust: { balance: { hi: { r: 0.12, b: -0.1 } } } },
    ],
  },
  {
    key: 'coldMorning',
    name: 'studio.image.looks.coldMorning',
    steps: [
      { kind: 'whiteBalance', name: k('cool'), adjust: { temperature: -0.15 } },
      { kind: 'colorBalance', name: k('balance'), adjust: { balance: { sh: { b: 0.15 }, mid: { g: 0.04, b: 0.06 } } } },
      { kind: 'saturation', name: k('saturation'), adjust: { saturation: -0.1 } },
    ],
  },
  {
    key: 'vintage',
    name: 'studio.image.looks.vintage',
    steps: [
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: -0.1 } },
      { kind: 'colorBalance', name: k('balance'), adjust: { balance: { sh: { r: 0.1, g: 0.05, b: -0.1 }, hi: { r: 0.08, b: -0.12 } } } },
      { kind: 'vignette', name: k('vignette'), adjust: { vignette: 0.35 } },
    ],
    hsl: { blue: { s: -0.3 }, green: { h: -0.1, s: -0.2 } },
  },
  {
    key: 'cinematic',
    name: 'studio.image.looks.cinematic',
    steps: [
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: 0.12 } },
      { kind: 'colorBalance', name: k('balance'), adjust: { balance: { sh: { r: -0.1, b: 0.15 }, hi: { r: 0.14, b: -0.12 } } } },
      { kind: 'vignette', name: k('vignette'), adjust: { vignette: 0.25 } },
    ],
    hsl: { orange: { s: 0.1 }, aqua: { s: 0.15 } },
  },
  {
    key: 'pop',
    name: 'studio.image.looks.pop',
    steps: [
      { kind: 'contrast', name: k('contrast'), adjust: { contrast: 0.2 } },
      { kind: 'saturation', name: k('saturation'), adjust: { saturation: 0.25 } },
      { kind: 'custom', name: k('tone'), adjust: { shadows: 0.1, whites: 0.1 } },
    ],
  },
];

/**
 * A look a fotóra: a verem és a színenkénti HSL CSERÉJE (nem halmozódik a meglévőre — egy look az alap,
 * amiből tovább lehet állítani). `label`: a lépés-nevek fordítása (a sajátnál a név maga).
 */
export function applyLook(look: ImageLook, label: (name: string) => string = (n) => n): Pick<PhotoLayer, 'adjustmentStack' | 'adjust' | 'hsl'> {
  const stack: AdjustmentLayer[] = look.steps.map((s) => createAdjustment(s.kind, { ...s.adjust }, look.custom ? s.name : label(s.name)));
  const adjust = flattenAdjustments(stack);
  return {
    adjustmentStack: stack,
    adjust: Object.keys(adjust).length ? adjust : undefined,
    hsl: look.hsl && !isNeutralHsl(look.hsl) ? look.hsl : undefined,
  };
}

/** a fotó jelenlegi verme + HSL-je saját lookként (a kikapcsolt lépések kimaradnak, az erősség beleszámít) */
export function lookFromLayer(layer: Pick<PhotoLayer, 'adjustmentStack' | 'adjust' | 'hsl'>, key: string, name: string): ImageLook | null {
  const stack = layer.adjustmentStack?.filter((s) => s.enabled && s.amount > 0) ?? [];
  const steps: LookStep[] = stack.length
    ? stack.map((s) => ({ kind: s.kind, name: s.name, adjust: s.amount === 1 ? s.adjust : flattenAdjustments([{ ...s, amount: s.amount }]) }))
    : layer.adjust && Object.keys(layer.adjust).length
      ? [{ kind: 'custom', name, adjust: layer.adjust }]
      : [];
  const hsl = layer.hsl && !isNeutralHsl(layer.hsl) ? layer.hsl : undefined;
  if (steps.length === 0 && !hsl) return null;
  return { key, name, steps, ...(hsl ? { hsl } : {}), custom: true };
}

/** egy tárolt (JSON-ból olvasott) look érvényes-e */
export function isLook(x: unknown): x is ImageLook {
  const l = x as ImageLook;
  return !!l && typeof l.key === 'string' && typeof l.name === 'string' && Array.isArray(l.steps) && l.steps.every((s) => !!s && typeof s.kind === 'string' && !!s.adjust && typeof s.adjust === 'object');
}
