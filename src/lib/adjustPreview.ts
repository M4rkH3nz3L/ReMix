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
  const push = (color: string, op: number) => {
    if (op > 0.01) {
      layers.push({ color, opacity: Math.min(0.6, op) });
    }
  };
  // Luminancia-közelítés: expozíció (stop) + fényerő + a tónusvezérlők nettó
  // világosítása. Az overlay nem tud tónus-régióra hatni, így a highlights/
  // shadows/whites/blacks nettó eredőjét egyetlen fehér/fekete rétegként adjuk
  // — a pontos, régió-szelektív görbe a renderben ég be.
  const lum =
    (adjust.exposure ?? 0) * 0.5 +
    (adjust.brightness ?? 0) * 1.4 +
    (adjust.whites ?? 0) * 0.3 +
    (adjust.blacks ?? 0) * 0.3 +
    (adjust.highlights ?? 0) * 0.25 +
    (adjust.shadows ?? 0) * 0.25 +
    (adjust.hslLuminance ?? 0) * 0.5;
  if (lum !== 0) {
    push(lum > 0 ? '#ffffff' : '#000000', Math.abs(lum));
  }
  const t = adjust.temperature ?? 0;
  if (t !== 0) {
    push(t > 0 ? '#ff9d4d' : '#4d9dff', Math.abs(t) * 1.1);
  }
  // árnyalat: zöld ↔ magenta
  const ti = adjust.tint ?? 0;
  if (ti !== 0) {
    push(ti > 0 ? '#ff4dff' : '#4dff4d', Math.abs(ti) * 1.1);
  }
  // deszaturáció (Basic saturation + HSL-telítettség együtt), csak csökkentésnél
  const s = (adjust.saturation ?? 0) + (adjust.hslSaturation ?? 0);
  if (s < 0) {
    push('#808080', -s * 0.55);
  }
  return layers;
}
