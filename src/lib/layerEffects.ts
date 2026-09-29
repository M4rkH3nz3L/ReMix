import { makeId } from '@/lib/id';

/**
 * ✨ Layer-effektek mag (Creative Canvas) — pure effekt-verem + emit.
 *
 * A `ShapeClip` ma csak három primitívet ismer: `shadow?:boolean`,
 * `glow?:{color,size}`, `outline?:{color,width}` (a `TextStyle`-ban is hasonló).
 * Ez a mag egy TELJES, sorrendezett, ki/be-kapcsolható effekt-vermet ad
 * (Photoshop layer styles): vetett/belső árnyék, külső/belső ragyogás, kontúr,
 * szín-átfedés. Kimenet háromféle:
 *   1. `effectsToCssFilter` / `effectsToTextShadow` — ELŐNÉZET (RN/CSS),
 *   2. `effectsToSvgFilter` — RENDER-pontos SVG `<filter>` (belső árnyék/glow is),
 *   3. `toShapePrimitives` — le-map a MEGLÉVŐ ShapeClip mezőkre (mai render).
 *
 * Mérték-konvenció: `dx`/`dy`/`blur`/`width`/`size` a vászon MAGASSÁGÁNAK %-a
 * (mint a meglévő `glow.size`/`outline.width`); `opacity` 0…1; szín hex.
 */

export type EffectKind =
  | 'dropShadow'
  | 'innerShadow'
  | 'outerGlow'
  | 'innerGlow'
  | 'stroke'
  | 'colorOverlay';

interface EffectBase {
  id: string;
  enabled: boolean;
}
export interface DropShadow extends EffectBase {
  kind: 'dropShadow';
  color: string;
  dx: number;
  dy: number;
  blur: number;
  opacity: number;
}
export interface InnerShadow extends EffectBase {
  kind: 'innerShadow';
  color: string;
  dx: number;
  dy: number;
  blur: number;
  opacity: number;
}
export interface OuterGlow extends EffectBase {
  kind: 'outerGlow';
  color: string;
  blur: number;
  opacity: number;
}
export interface InnerGlow extends EffectBase {
  kind: 'innerGlow';
  color: string;
  blur: number;
  opacity: number;
}
export interface Stroke extends EffectBase {
  kind: 'stroke';
  color: string;
  width: number;
  position: 'outside' | 'center' | 'inside';
}
export interface ColorOverlay extends EffectBase {
  kind: 'colorOverlay';
  color: string;
  opacity: number;
}
export type LayerEffect = DropShadow | InnerShadow | OuterGlow | InnerGlow | Stroke | ColorOverlay;

const DEFAULTS: Record<EffectKind, Omit<LayerEffect, 'id' | 'kind' | 'enabled'>> = {
  dropShadow: { color: '#000000', dx: 0.6, dy: 0.6, blur: 1, opacity: 0.5 } as never,
  innerShadow: { color: '#000000', dx: 0.4, dy: 0.4, blur: 0.8, opacity: 0.5 } as never,
  outerGlow: { color: '#ffffff', blur: 1.5, opacity: 0.75 } as never,
  innerGlow: { color: '#ffffff', blur: 1, opacity: 0.75 } as never,
  stroke: { color: '#000000', width: 0.5, position: 'outside' } as never,
  colorOverlay: { color: '#000000', opacity: 1 } as never,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;
/** % (vászon-magasság) → px a `refPx` alapján */
const toPx = (pct: number, refPx: number) => round((pct / 100) * refPx);

// ── Verem-műveletek ──────────────────────────────────────────────────────────

/** új effekt (engedélyezve, kind-specifikus alapokkal + felülírással). */
export function createEffect<K extends EffectKind>(
  kind: K,
  overrides: Partial<Extract<LayerEffect, { kind: K }>> = {}
): Extract<LayerEffect, { kind: K }> {
  return {
    id: makeId('fx'),
    kind,
    enabled: true,
    ...DEFAULTS[kind],
    ...overrides,
  } as Extract<LayerEffect, { kind: K }>;
}

export function addEffect(stack: LayerEffect[], fx: LayerEffect, atIndex?: number): LayerEffect[] {
  const out = stack.slice();
  if (atIndex == null || atIndex >= out.length) out.push(fx);
  else out.splice(Math.max(0, atIndex), 0, fx);
  return out;
}

export function removeEffect(stack: LayerEffect[], id: string): LayerEffect[] {
  return stack.filter((f) => f.id !== id);
}

export function reorderEffect(stack: LayerEffect[], id: string, delta: number): LayerEffect[] {
  const i = stack.findIndex((f) => f.id === id);
  if (i < 0) return stack;
  const j = Math.min(stack.length - 1, Math.max(0, i + delta));
  if (i === j) return stack;
  const out = stack.slice();
  const [item] = out.splice(i, 1);
  out.splice(j, 0, item);
  return out;
}

export function toggleEffect(stack: LayerEffect[], id: string, enabled?: boolean): LayerEffect[] {
  return stack.map((f) => (f.id === id ? { ...f, enabled: enabled ?? !f.enabled } : f));
}

export function updateEffect(stack: LayerEffect[], id: string, patch: Partial<LayerEffect>): LayerEffect[] {
  return stack.map((f) => (f.id === id ? ({ ...f, ...patch, id: f.id, kind: f.kind } as LayerEffect) : f));
}

const active = (stack: LayerEffect[]) => stack.filter((f) => f.enabled);

// ── Emit 1: CSS (előnézet) ───────────────────────────────────────────────────

const rgba = (hex: string, a: number): string => {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${round(clamp01(a))})`;
};

/**
 * CSS `filter` érték az ELŐNÉZETHEZ: a vetett árnyék és a külső ragyogás
 * `drop-shadow()`-ként (az alfa-sziluettet követi, tetszőleges alakon). A belső
 * effektek/kontúr itt nem képezhetők le pontosan → azok az SVG-filterben élnek.
 */
export function effectsToCssFilter(stack: LayerEffect[], refPx = 1000): string {
  const parts: string[] = [];
  for (const f of active(stack)) {
    if (f.kind === 'dropShadow') {
      parts.push(`drop-shadow(${toPx(f.dx, refPx)}px ${toPx(f.dy, refPx)}px ${toPx(f.blur, refPx)}px ${rgba(f.color, f.opacity)})`);
    } else if (f.kind === 'outerGlow') {
      // a ragyogás = eltolás nélküli, ismételt drop-shadow (a sziluettet követi)
      const g = `drop-shadow(0 0 ${toPx(f.blur, refPx)}px ${rgba(f.color, f.opacity)})`;
      parts.push(g, g);
    }
  }
  return parts.join(' ');
}

/** CSS `text-shadow` lista szöveg-réteghez (drop-shadow + glow). */
export function effectsToTextShadow(stack: LayerEffect[], refPx = 1000): string {
  const parts: string[] = [];
  for (const f of active(stack)) {
    if (f.kind === 'dropShadow') {
      parts.push(`${toPx(f.dx, refPx)}px ${toPx(f.dy, refPx)}px ${toPx(f.blur, refPx)}px ${rgba(f.color, f.opacity)}`);
    } else if (f.kind === 'outerGlow') {
      const g = `0 0 ${toPx(f.blur, refPx)}px ${rgba(f.color, f.opacity)}`;
      parts.push(g, g);
    }
  }
  return parts.join(', ');
}

// ── Emit 2: SVG <filter> (render-pontos) ─────────────────────────────────────

/**
 * Render-pontos SVG `<filter>` — a teljes effekt-készlet, a BELSŐ árnyék/glow és
 * a kontúr is. A kimenő-régió kitágítva (−50%…150%), hogy a blur ne vágódjon.
 * A behind[] a forrás MÖGÉ, a front[] a forrás FÖLÉ kerül (feMerge sorrend).
 */
export function effectsToSvgFilter(stack: LayerEffect[], id: string, refPx = 1000): string {
  const prims: string[] = [];
  const behind: string[] = [];
  const front: string[] = [];
  let n = 0;
  for (const f of active(stack)) {
    const out = `fx${n++}`;
    const blurPx = 'blur' in f ? toPx(f.blur, refPx) : 0;
    const dxPx = 'dx' in f ? toPx(f.dx, refPx) : 0;
    const dyPx = 'dy' in f ? toPx(f.dy, refPx) : 0;
    if (f.kind === 'dropShadow' || f.kind === 'outerGlow') {
      prims.push(
        `<feGaussianBlur in="SourceAlpha" stdDeviation="${blurPx}" result="${out}b"/>`,
        `<feOffset dx="${dxPx}" dy="${dyPx}" in="${out}b" result="${out}o"/>`,
        `<feFlood flood-color="${f.color}" flood-opacity="${round(clamp01(f.opacity))}" result="${out}c"/>`,
        `<feComposite in="${out}c" in2="${out}o" operator="in" result="${out}"/>`
      );
      behind.push(out);
    } else if (f.kind === 'innerShadow' || f.kind === 'innerGlow') {
      prims.push(
        `<feGaussianBlur in="SourceAlpha" stdDeviation="${blurPx}" result="${out}b"/>`,
        `<feOffset dx="${dxPx}" dy="${dyPx}" in="${out}b" result="${out}o"/>`,
        // a sziluetten BELÜL: SourceAlpha − eltolt-blur
        `<feComposite in="SourceAlpha" in2="${out}o" operator="out" result="${out}i"/>`,
        `<feFlood flood-color="${f.color}" flood-opacity="${round(clamp01(f.opacity))}" result="${out}c"/>`,
        `<feComposite in="${out}c" in2="${out}i" operator="in" result="${out}"/>`
      );
      front.push(out);
    } else if (f.kind === 'stroke') {
      const w = toPx(f.width, refPx);
      const op = f.position === 'inside' ? 'erode' : 'dilate';
      prims.push(
        `<feMorphology in="SourceAlpha" operator="${op}" radius="${w}" result="${out}m"/>`,
        // outside/center: a kitágított − eredeti gyűrű; inside: eredeti − szűkített
        f.position === 'inside'
          ? `<feComposite in="SourceAlpha" in2="${out}m" operator="out" result="${out}r"/>`
          : `<feComposite in="${out}m" in2="SourceAlpha" operator="out" result="${out}r"/>`,
        `<feFlood flood-color="${f.color}" result="${out}c"/>`,
        `<feComposite in="${out}c" in2="${out}r" operator="in" result="${out}"/>`
      );
      (f.position === 'inside' ? front : behind).push(out);
    } else if (f.kind === 'colorOverlay') {
      prims.push(
        `<feFlood flood-color="${f.color}" flood-opacity="${round(clamp01(f.opacity))}" result="${out}c"/>`,
        `<feComposite in="${out}c" in2="SourceAlpha" operator="in" result="${out}"/>`
      );
      front.push(out);
    }
  }
  const merge = [...behind, 'SourceGraphic', ...front]
    .map((r) => `<feMergeNode in="${r}"/>`)
    .join('');
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${prims.join('')}<feMerge>${merge}</feMerge></filter>`;
}

// ── Emit 3: le-map a meglévő ShapeClip mezőkre (mai render) ───────────────────

export interface ShapePrimitives {
  shadow?: boolean;
  glow?: { color: string; size: number };
  outline?: { color: string; width: number };
}

/**
 * A verem → a MEGLÉVŐ `ShapeClip` primitívek (best-effort, hogy a mai render is
 * mutasson valamit): az első engedélyezett drop/inner-shadow → `shadow:true`, az
 * első glow → `glow`, az első kontúr → `outline`. A finomabb paraméterek az
 * SVG-filter úton élnek.
 */
export function toShapePrimitives(stack: LayerEffect[]): ShapePrimitives {
  const out: ShapePrimitives = {};
  for (const f of active(stack)) {
    if ((f.kind === 'dropShadow' || f.kind === 'innerShadow') && out.shadow === undefined) {
      out.shadow = true;
    } else if ((f.kind === 'outerGlow' || f.kind === 'innerGlow') && !out.glow) {
      out.glow = { color: f.color, size: round(f.blur) };
    } else if (f.kind === 'stroke' && !out.outline) {
      out.outline = { color: f.color, width: round(f.width) };
    }
  }
  return out;
}

/** van-e bármilyen ható (engedélyezett) effekt? */
export function hasEffects(stack: LayerEffect[]): boolean {
  return stack.some((f) => f.enabled);
}
