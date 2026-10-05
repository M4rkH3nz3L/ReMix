/**
 * 🎛️ Videó effekt-lánc (audit §6.5) — tiszta, expo-mentes mag.
 *
 * A mai modell: egyetlen `filterId` + fix-sorrendű adjust/lut. Ez EGY rendezhető,
 * sorrend-függő effekt-láncot ad a klipre (`clip.effects[]`), ami a meglévő
 * megjelenés-lánc UTÁN fut → additív, a mai klipek változatlanok (üres/hiányzó lánc
 * = nincs hatás). Minden effekt egy önálló FFmpeg-filterre képződik (render) — a
 * leképezés tiszta függvény, ezért unit-tesztelhető.
 *
 * A műveletek IMMUTÁBILISak (új tömböt adnak) → a command-buson `UPDATE_CLIP`
 * patch-csel mennek (mint a többi klip-szerkesztés), undo-zhatóan.
 */

import type { VideoEffect, VideoEffectType } from '@/types/project';

export interface EffectMeta {
  label: string; // i18n-kulcs
  /** parametrikus-e (0–1 `amount`), vagy fix (pl. invert). */
  parametric: boolean;
  defaultAmount: number;
}

/** Az effekt-katalógus — EGY hely, ami kimondja a típusokat + alapértékeket. */
export const VIDEO_EFFECTS: Record<VideoEffectType, EffectMeta> = {
  blur: { label: 'lib.effects.blur', parametric: true, defaultAmount: 0.4 },
  sharpen: { label: 'lib.effects.sharpen', parametric: true, defaultAmount: 0.5 },
  vignette: { label: 'lib.effects.vignette', parametric: true, defaultAmount: 0.5 },
  grain: { label: 'lib.effects.grain', parametric: true, defaultAmount: 0.3 },
  grayscale: { label: 'lib.effects.grayscale', parametric: false, defaultAmount: 1 },
  sepia: { label: 'lib.effects.sepia', parametric: false, defaultAmount: 1 },
  invert: { label: 'lib.effects.invert', parametric: false, defaultAmount: 1 },
};

export const VIDEO_EFFECT_TYPES = Object.keys(VIDEO_EFFECTS) as VideoEffectType[];

/** 0–1-re szorítás. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── immutábilis lánc-műveletek (UPDATE_CLIP patch-hez) ──────────────────────

/** Új effekt a lánc VÉGÉRE (a `genId` injektált → tesztelhető, determinisztikus). */
export function addEffect(
  effects: VideoEffect[] | undefined,
  type: VideoEffectType,
  genId: () => string,
): VideoEffect[] {
  const next: VideoEffect = { id: genId(), type, amount: VIDEO_EFFECTS[type].defaultAmount };
  return [...(effects ?? []), next];
}

export function removeEffect(effects: VideoEffect[] | undefined, id: string): VideoEffect[] {
  return (effects ?? []).filter((e) => e.id !== id);
}

/** Effekt mozgatása a láncban (`delta` = -1 fel / +1 le). Határon no-op. */
export function moveEffect(
  effects: VideoEffect[] | undefined,
  id: string,
  delta: number,
): VideoEffect[] {
  const list = [...(effects ?? [])];
  const i = list.indexOf(list.find((e) => e.id === id) as VideoEffect);
  if (i < 0) {
    return list;
  }
  const j = i + delta;
  if (j < 0 || j >= list.length) {
    return list;
  }
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

export function toggleEffect(effects: VideoEffect[] | undefined, id: string): VideoEffect[] {
  return (effects ?? []).map((e) =>
    e.id === id ? { ...e, enabled: e.enabled === false ? undefined : false } : e,
  );
}

export function setEffectAmount(
  effects: VideoEffect[] | undefined,
  id: string,
  amount: number,
): VideoEffect[] {
  return (effects ?? []).map((e) => (e.id === id ? { ...e, amount: clamp01(amount) } : e));
}

/** A ténylegesen alkalmazandó effektek: engedélyezettek, lánc-sorrendben. */
export function resolveEffects(effects: VideoEffect[] | undefined): VideoEffect[] {
  return (effects ?? []).filter((e) => e.enabled !== false);
}

// ── render: effekt → FFmpeg-filter (tiszta leképezés) ───────────────────────

/** Egy effekt FFmpeg-filtere (vesszőtlen, a filtergraph-ban láncolható). */
export function effectFilterString(effect: VideoEffect): string {
  const a = clamp01(effect.amount ?? VIDEO_EFFECTS[effect.type].defaultAmount);
  switch (effect.type) {
    case 'blur':
      return `gblur=sigma=${(a * 20).toFixed(2)}`;
    case 'sharpen':
      return `unsharp=5:5:${(a * 2).toFixed(3)}:5:5:0`;
    case 'vignette':
      return `vignette=a=${(0.1 + a * 1.1).toFixed(3)}`;
    case 'grain':
      return `noise=alls=${Math.round(a * 40)}:allf=t+u`;
    case 'grayscale':
      return `hue=s=0`;
    case 'sepia':
      return `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`;
    case 'invert':
      return `negate`;
    default:
      return '';
  }
}

/**
 * A teljes effekt-lánc vesszős FFmpeg-füzére (a resolved effektek sorrendben),
 * VEZETŐ vesszővel ha nem üres (a megjelenés-lánc után fűzhető) — üres, ha nincs effekt.
 */
export function effectChainFilters(effects: VideoEffect[] | undefined): string {
  const parts = resolveEffects(effects).map(effectFilterString).filter(Boolean);
  return parts.length ? ',' + parts.join(',') : '';
}
