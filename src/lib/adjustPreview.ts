import type { ClipAdjust } from '@/types/project';

/**
 * Képjavítás-közelítés (ON-DEVICE ELŐNÉZET): a ClipAdjust értékekből
 * féligátlátszó tint-rétegek (fényerő / hőmérséklet / deszaturáció). Ugyanez fut
 * a per-klip adjustra, a grade-réteg overlay-ére ÉS a Kép Stúdió Korrekció
 * előnézetére — a pontos eq/colorbalance/vignette a (szintén eszközön futó)
 * renderben ég be. Pure réteg, hogy a preview és a stúdió PONTOSAN egyezzen.
 */
export function adjustTintLayers(adjust: ClipAdjust): { color: string; opacity: number }[] {
  const layers: { color: string; opacity: number }[] = [];
  const b = adjust.brightness ?? 0;
  if (b !== 0) {
    layers.push({
      color: b > 0 ? '#ffffff' : '#000000',
      opacity: Math.min(0.5, Math.abs(b) * 1.4),
    });
  }
  const t = adjust.temperature ?? 0;
  if (t !== 0) {
    layers.push({
      color: t > 0 ? '#ff9d4d' : '#4d9dff',
      opacity: Math.min(0.4, Math.abs(t) * 1.1),
    });
  }
  const s = adjust.saturation ?? 0;
  if (s < 0) {
    layers.push({ color: '#808080', opacity: Math.min(0.6, -s * 0.55) });
  }
  return layers;
}
