import type { ImageLayer } from '@/types/project';

/**
 * 🎨 Réteg-stílusok a réteg ALAKJÁN BELÜL (IMAGE-PROD S13 · PRO-DESIGN DS5) — pure mag.
 *
 * Színátfedés, belső ragyogás, belső árnyék (a Photoshop sorrendjében: a réteg → átfedés → ragyogás →
 * árnyék). A vászon (Skia) és a szerver (ffmpeg) ugyanezeket a feloldott értékeket rajzolja: a méretek
 * a vászon törtjei (a belső árnyék dy-ja a magasságé, mint a vetett árnyéknál).
 */
export interface InnerEffects {
  overlay: { color: string; opacity: number } | null;
  glow: { color: string; size: number; opacity: number } | null;
  shadow: { color: string; dx: number; dy: number; blur: number; opacity: number } | null;
}

export const INNER_DEFAULTS = {
  overlay: { color: '#ff2d95', opacity: 1 },
  glow: { color: '#ffffff', size: 0.02, opacity: 0.75 },
  shadow: { color: '#000000', dx: 0.012, dy: 0.012, blur: 0.012, opacity: 0.6 },
} as const;

/** a réteg belső effektjei alapértékekkel kitöltve (fotó és forma; a szöveg és a háttér nem) */
export function innerEffectsOf(layer: ImageLayer): InnerEffects | null {
  if (layer.kind !== 'photo' && layer.kind !== 'shape') return null;
  const o = layer.colorOverlay;
  const g = layer.innerGlow;
  const s = layer.innerShadow;
  if (!o && !g && !s) return null;
  const clamp01 = (v: number | undefined, d: number) => Math.max(0, Math.min(1, v ?? d));
  return {
    overlay: o ? { color: o.color, opacity: clamp01(o.opacity, INNER_DEFAULTS.overlay.opacity) } : null,
    glow: g ? { color: g.color ?? INNER_DEFAULTS.glow.color, size: Math.max(0, g.size ?? INNER_DEFAULTS.glow.size), opacity: clamp01(g.opacity, INNER_DEFAULTS.glow.opacity) } : null,
    shadow: s
      ? {
          color: s.color ?? INNER_DEFAULTS.shadow.color,
          dx: s.dx ?? INNER_DEFAULTS.shadow.dx,
          dy: s.dy ?? INNER_DEFAULTS.shadow.dy,
          blur: Math.max(0, s.blur ?? INNER_DEFAULTS.shadow.blur),
          opacity: clamp01(s.opacity, INNER_DEFAULTS.shadow.opacity),
        }
      : null,
  };
}
