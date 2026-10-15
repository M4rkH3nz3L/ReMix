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
  chromaticAberration: { label: 'lib.effects.chromaticAberration', parametric: true, defaultAmount: 0.5 },
  lightLeak: { label: 'lib.effects.lightLeak', parametric: true, defaultAmount: 0.6 },
  motionBlur: { label: 'lib.effects.motionBlur', parametric: true, defaultAmount: 0.5 },
  deflicker: { label: 'lib.effects.deflicker', parametric: true, defaultAmount: 0.5 },
  clarity: { label: 'lib.effects.clarity', parametric: true, defaultAmount: 0.5 },
  dehaze: { label: 'lib.effects.dehaze', parametric: true, defaultAmount: 0.5 },
  pixelate: { label: 'lib.effects.pixelate', parametric: true, defaultAmount: 0.5 },
  posterize: { label: 'lib.effects.posterize', parametric: true, defaultAmount: 0.5 },
  scanlines: { label: 'lib.effects.scanlines', parametric: true, defaultAmount: 0.6 },
  halftone: { label: 'lib.effects.halftone', parametric: true, defaultAmount: 0.5 },
};

// 🌅 fényszivárgás gauss-esése a JOBB-FELSŐ sarokból (geq; `W` a frame-szélesség) — kliens/worker AZONOS
export const LIGHT_LEAK_L = 'exp(-((X-W)*(X-W)+Y*Y)/(2*(W*0.4)*(W*0.4)))';

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
    case 'chromaticAberration': {
      // RGB-szétcsúsztatás (R jobbra, B balra) — élek mentén szín-fringe
      const n = Math.round(a * 12);
      return `rgbashift=rh=${n}:bh=${-n}`;
    }
    case 'lightLeak':
      // meleg (R↑ G↑) gauss-glow a jobb-felső sarokból; a B változatlan
      return `format=gbrp,geq=r='min(255,r(X,Y)+${(a * 1.4).toFixed(3)}*255*${LIGHT_LEAK_L})':g='min(255,g(X,Y)+${(a * 0.8).toFixed(3)}*255*${LIGHT_LEAK_L})':b='b(X,Y)'`;
    case 'motionBlur':
      // temporális kocka-átlag (mozgásra elmosódás-csík); 2–8 kocka
      return `tmix=frames=${2 + Math.round(a * 6)}`;
    case 'deflicker':
      // temporális luma-villódzás simítás; 2–10 kocka ablak
      return `deflicker=size=${2 + Math.round(a * 8)}:mode=pm`;
    // ── 🖼️ kép-paritás: a Kép Stúdió struktúra-szűrői (imageFilters.oneFilter) AZONOS stringgel ──
    case 'clarity':
      return `unsharp=lx=13:ly=13:la=${(a * 1.5).toFixed(2)}`;
    case 'dehaze':
      return `eq=contrast=${(1 + a * 0.6).toFixed(3)}:saturation=${(1 + a * 0.4).toFixed(3)}`;
    case 'pixelate': {
      const block = 2 + Math.round(a * 22);
      return `pixelize=w=${block}:h=${block}`;
    }
    case 'posterize': {
      const step = Math.round(8 + a * 120);
      return `lutrgb=r='trunc(val/${step})*${step}':g='trunc(val/${step})*${step}':b='trunc(val/${step})*${step}'`;
    }
    case 'scanlines': {
      // 🖥️ CRT-szkennvonal: a páratlan sorok sötétítése (szín megmarad, gbrp)
      const f = `(1-${(a * 0.6).toFixed(3)}*mod(Y,2))`;
      return `format=gbrp,geq=r='r(X,Y)*${f}':g='g(X,Y)*${f}':b='b(X,Y)*${f}'`;
    }
    case 'halftone': {
      // ⚫ halftone: monokróm pont-raszter, a pont sugara a luminanciával arányos; amount = csempeméret
      const T = 4 + Math.round(a * 10);
      const h = (T / 2).toFixed(1);
      return `format=gray,geq=lum='255*lte((mod(X,${T})-${h})*(mod(X,${T})-${h})+(mod(Y,${T})-${h})*(mod(Y,${T})-${h}),${((T * T) / 4).toFixed(2)}*(lum(X,Y)/255))'`;
    }
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
