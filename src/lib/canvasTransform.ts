import type { CanvasTransform } from '@/types/project';

/**
 * ⚓⬛ Vászon-transzform kiterjesztések (audit §6.6): anchor-point (pivot) + skew.
 * Tiszta, expo-mentes mag — a [PreviewSurface](../components/preview/PreviewSurface.tsx)
 * (RN `transformOrigin` + `skewX/Y`) és a render ([server/render.js](../../server/render.js),
 * a `shearPoint` sarok-warpja) UGYANEBBŐL dolgozik → preview==render paritás.
 *
 * Additív + backward-compat: anchor hiányzó = közép (0.5,0.5), skew hiányzó = 0 →
 * a mai klipek viselkedése bitre változatlan.
 */

const DEG = Math.PI / 180;

/** Az anchor (pivot) 0–1 → RN/CSS `transformOrigin` ('x% y%'). Default közép. */
export function transformOrigin(t: CanvasTransform | undefined): string {
  const ax = t?.anchorX ?? 0.5;
  const ay = t?.anchorY ?? 0.5;
  return `${(ax * 100).toFixed(4).replace(/\.?0+$/, '')}% ${(ay * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

/** Nem-alapértelmezett (nem közép) anchor van-e beállítva. */
export function hasCustomAnchor(t: CanvasTransform | undefined): boolean {
  if (!t) {
    return false;
  }
  return (t.anchorX !== undefined && t.anchorX !== 0.5) || (t.anchorY !== undefined && t.anchorY !== 0.5);
}

/** Van-e (nemnulla) skew. */
export function hasSkew(t: CanvasTransform | undefined): boolean {
  return !!t && ((t.skewX ?? 0) !== 0 || (t.skewY ?? 0) !== 0);
}

export type SkewEntry = { skewX: string } | { skewY: string };

/** RN transform-tömb skew-bejegyzései (csak nemnulla tengelyek, `deg`-ben). */
export function skewTransformEntries(t: CanvasTransform | undefined): SkewEntry[] {
  const out: SkewEntry[] = [];
  const sx = t?.skewX ?? 0;
  const sy = t?.skewY ?? 0;
  if (sx !== 0) {
    out.push({ skewX: `${sx}deg` });
  }
  if (sy !== 0) {
    out.push({ skewY: `${sy}deg` });
  }
  return out;
}

/**
 * Egy pont nyírása (shear) fokban megadott skewX/skewY-nal. A render ezzel számolja
 * a perspektíva-filter négy VETÍTETT sarkát (a preview RN-skew-je ezt közelíti):
 *   x' = x + y·tan(skewX),   y' = y + x·tan(skewY)
 */
export function shearPoint(
  x: number,
  y: number,
  skewXDeg: number,
  skewYDeg: number,
): { x: number; y: number } {
  return {
    x: x + y * Math.tan(skewXDeg * DEG),
    y: y + x * Math.tan(skewYDeg * DEG),
  };
}

/**
 * A klip-doboz (egységnégyzet, sarkai 0..1) négy vetített sarka skew után — a render
 * perspektíva-filteréhez (sorrend: bal-fent, jobb-fent, jobb-lent, bal-lent).
 */
export function skewUnitCorners(
  skewXDeg: number,
  skewYDeg: number,
): { x: number; y: number }[] {
  return [
    shearPoint(0, 0, skewXDeg, skewYDeg),
    shearPoint(1, 0, skewXDeg, skewYDeg),
    shearPoint(1, 1, skewXDeg, skewYDeg),
    shearPoint(0, 1, skewXDeg, skewYDeg),
  ];
}
