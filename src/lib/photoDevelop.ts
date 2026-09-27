import type { ClipAdjust } from '@/types/project';

/**
 * 📸 RAW-develop mag (S-PHOTO — MASTER §3) — NEM-DESTRUKTÍV fotó-előhívás:
 * a meglévő `ClipAdjust` tónus/szín-vezérlőire (exposure/highlights/shadows/
 * temperature/tint/vibrance/görbék — [types/project]) épít, és hozzáadja a RAW-
 * specifikus DETAIL-paramétereket (clarity/texture/dehaze/sharpness/noise/CA/
 * torzítás), plusz a fotós-workflow magját: **copy/paste + sync edits** (csoport-
 * allowlist), clamp/neutral és egy deklaratív filter-terv a workerhez.
 *
 * Tiszta, expo-mentes. A RAW-DEKÓDOLÁS (DNG/ProRAW) natív/worker; ez a PARAMÉTER-
 * modell, ami a fájl mellett él és renderkor alkalmazódik (non-destruktív).
 */

export interface DetailParams {
  /** középtónus-kontraszt (-1…1) */
  clarity?: number;
  /** finom textúra (-1…1) */
  texture?: number;
  /** pára-eltávolítás (-1…1) */
  dehaze?: number;
  /** élesítés (0…1) */
  sharpness?: number;
  /** zajcsökkentés (0…1) */
  noiseReduction?: number;
  /** kromatikus aberráció korrekció (0…1) */
  chromaticAberration?: number;
  /** lencse-torzítás korrekció: barrel ↔ pincushion (-1…1) */
  lensDistortion?: number;
}

export interface PhotoDevelop {
  /** tónus/szín (a meglévő, renderben már támogatott `ClipAdjust`) */
  base: ClipAdjust;
  /** RAW-detail (új) */
  detail: DetailParams;
}

// ── Tartományok (a clamp + neutral-detektálás forrása) ───────────────────────

const BASE_RANGES: Partial<Record<keyof ClipAdjust, [number, number]>> = {
  brightness: [-0.3, 0.3],
  contrast: [-0.4, 0.4],
  saturation: [-1, 1],
  temperature: [-0.3, 0.3],
  vignette: [0, 1],
  exposure: [-1, 1],
  highlights: [-1, 1],
  shadows: [-1, 1],
  whites: [-1, 1],
  blacks: [-1, 1],
  tint: [-0.3, 0.3],
  vibrance: [-1, 1],
  hue: [-1, 1],
  hslSaturation: [-1, 1],
  hslLuminance: [-1, 1],
};

const DETAIL_RANGES: Record<keyof DetailParams, [number, number]> = {
  clarity: [-1, 1],
  texture: [-1, 1],
  dehaze: [-1, 1],
  sharpness: [0, 1],
  noiseReduction: [0, 1],
  chromaticAberration: [0, 1],
  lensDistortion: [-1, 1],
};

const clamp = (v: number, [lo, hi]: [number, number]): number => Math.max(lo, Math.min(hi, v));

export function neutralDevelop(): PhotoDevelop {
  return { base: {}, detail: {} };
}

/** Minden numerikus paramétert a dokumentált tartományba vág (immutábilis). */
export function clampDevelop(dev: PhotoDevelop): PhotoDevelop {
  const base: ClipAdjust = { ...dev.base };
  for (const key of Object.keys(BASE_RANGES) as (keyof ClipAdjust)[]) {
    const v = base[key];
    if (typeof v === 'number') {
      (base as Record<string, number>)[key] = clamp(v, BASE_RANGES[key]!);
    }
  }
  const detail: DetailParams = { ...dev.detail };
  for (const key of Object.keys(DETAIL_RANGES) as (keyof DetailParams)[]) {
    const v = detail[key];
    if (typeof v === 'number') {
      detail[key] = clamp(v, DETAIL_RANGES[key]);
    }
  }
  return { base, detail };
}

/** Igaz, ha az előhívás semmit sem változtat (minden 0/hiányzó, nincs görbe/3-way). */
export function isNeutralDevelop(dev: PhotoDevelop): boolean {
  for (const key of Object.keys(BASE_RANGES) as (keyof ClipAdjust)[]) {
    const v = dev.base[key];
    if (typeof v === 'number' && v !== 0) {
      return false;
    }
  }
  if (dev.base.curves || dev.base.balance) {
    return false;
  }
  for (const key of Object.keys(DETAIL_RANGES) as (keyof DetailParams)[]) {
    const v = dev.detail[key];
    if (typeof v === 'number' && v !== 0) {
      return false;
    }
  }
  return true;
}

/** Mély másolat (a copy/paste-hez). */
export function copyDevelop(dev: PhotoDevelop): PhotoDevelop {
  return { base: { ...dev.base }, detail: { ...dev.detail } };
}

// ── Copy / paste / sync (a batch-fotózás magja) ──────────────────────────────

export type DevelopGroup = 'tone' | 'color' | 'detail' | 'lens';

export const DEVELOP_GROUPS: DevelopGroup[] = ['tone', 'color', 'detail', 'lens'];

/** melyik paraméterek tartoznak egy csoportba (base + detail kulcsok). */
const GROUP_KEYS: Record<DevelopGroup, { base: (keyof ClipAdjust)[]; detail: (keyof DetailParams)[] }> = {
  tone: {
    base: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'curves'],
    detail: ['clarity', 'dehaze'],
  },
  color: {
    base: ['temperature', 'tint', 'saturation', 'vibrance', 'hue', 'hslSaturation', 'hslLuminance', 'balance'],
    detail: [],
  },
  detail: { base: [], detail: ['texture', 'sharpness', 'noiseReduction'] },
  lens: { base: ['vignette'], detail: ['chromaticAberration', 'lensDistortion'] },
};

/**
 * „Sync edits": a `source` kiválasztott CSOPORTJAIT ráhúzza a `target`-re (a többi
 * paraméter marad). A fotós ezzel egy referencia-kép beállításait szinkronizálja
 * sok képre. Immutábilis; a nem-listázott kulcsok érintetlenek.
 */
export function syncDevelop(target: PhotoDevelop, source: PhotoDevelop, groups: DevelopGroup[]): PhotoDevelop {
  const base: ClipAdjust = { ...target.base };
  const detail: DetailParams = { ...target.detail };
  for (const g of groups) {
    for (const key of GROUP_KEYS[g].base) {
      const v = source.base[key];
      if (v === undefined) {
        delete (base as Record<string, unknown>)[key];
      } else {
        (base as Record<string, unknown>)[key] = v;
      }
    }
    for (const key of GROUP_KEYS[g].detail) {
      const v = source.detail[key];
      if (v === undefined) {
        delete detail[key];
      } else {
        detail[key] = v;
      }
    }
  }
  return { base, detail };
}

// ── Deklaratív filter-terv + összefoglaló ────────────────────────────────────

export interface DevelopFilterStep {
  param: string;
  value: number;
}

/**
 * A nem-neutrális paraméterek deklaratív listája (a worker/preview EBBŐL épít
 * ffmpeg/Skia láncot). Csak a 0-tól eltérő numerikus mezők kerülnek bele, stabil
 * sorrendben (tónus → szín → detail → lens).
 */
export function developToFilterPlan(dev: PhotoDevelop): DevelopFilterStep[] {
  const steps: DevelopFilterStep[] = [];
  const pushBase = (key: keyof ClipAdjust) => {
    const v = dev.base[key];
    if (typeof v === 'number' && v !== 0) {
      steps.push({ param: key, value: v });
    }
  };
  const pushDetail = (key: keyof DetailParams) => {
    const v = dev.detail[key];
    if (typeof v === 'number' && v !== 0) {
      steps.push({ param: key, value: v });
    }
  };
  (['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const).forEach(pushBase);
  (['temperature', 'tint', 'saturation', 'vibrance', 'hue', 'hslSaturation', 'hslLuminance'] as const).forEach(pushBase);
  (['clarity', 'texture', 'dehaze', 'sharpness', 'noiseReduction'] as const).forEach(pushDetail);
  pushBase('vignette');
  (['chromaticAberration', 'lensDistortion'] as const).forEach(pushDetail);
  return steps;
}

/** Aktív paraméter-nevek (a before/after és a preset-összefoglaló UI-hoz). */
export function summarizeDevelop(dev: PhotoDevelop): string[] {
  return developToFilterPlan(dev).map((s) => s.param);
}
