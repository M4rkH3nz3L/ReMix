/**
 * 🪄 Varázspálca-koordináták: a réteg DOBOZA és a kép SAJÁT pixelei közti leképezés a
 * `fit` szerint. A `cover` levágja a túllógó részt, a `contain` margót hagy — ezért a
 * doboz-pont nem azonos a kép-ponttal (csak `stretch`-nél).
 */
export type LayerFit = 'cover' | 'contain' | 'stretch' | undefined;

/** A kép dobozon belüli skálája tengelyenként (cover: <1 = levágva, contain: <1 = margó). */
function fitFractions(imageAspect: number, boxAspect: number, fit: LayerFit): { x: number; y: number } {
  if (fit === 'stretch') {
    return { x: 1, y: 1 };
  }
  const ratio = boxAspect / imageAspect;
  if (fit === 'contain') {
    return ratio < 1 ? { x: 1, y: ratio } : { x: 1 / ratio, y: 1 };
  }
  return ratio < 1 ? { x: ratio, y: 1 } : { x: 1, y: 1 / ratio };
}

/** Doboz-pont (0–1) → kép-pont (0–1). `null`, ha a koppintás a `contain` margójára esett. */
export function boxToImage(
  p: { x: number; y: number },
  imageAspect: number,
  boxAspect: number,
  fit: LayerFit
): { x: number; y: number } | null {
  const f = fitFractions(imageAspect, boxAspect, fit);
  const out =
    fit === 'contain'
      ? { x: 0.5 + (p.x - 0.5) / f.x, y: 0.5 + (p.y - 0.5) / f.y }
      : { x: 0.5 + (p.x - 0.5) * f.x, y: 0.5 + (p.y - 0.5) * f.y };
  return out.x < 0 || out.x > 1 || out.y < 0 || out.y > 1 ? null : out;
}

/** Kép-pont (0–1) → doboz-pont; a `cover` levágott része a dobozon kívülre esik (<0 vagy >1). */
export function imageToBoxRaw(p: { x: number; y: number }, imageAspect: number, boxAspect: number, fit: LayerFit): { x: number; y: number } {
  const f = fitFractions(imageAspect, boxAspect, fit);
  return fit === 'contain'
    ? { x: 0.5 + (p.x - 0.5) * f.x, y: 0.5 + (p.y - 0.5) * f.y }
    : { x: 0.5 + (p.x - 0.5) / f.x, y: 0.5 + (p.y - 0.5) / f.y };
}

/** Kép-pont (0–1) → doboz-pont (0–1); a `cover` levágott része a doboz szélére szorul. */
export function imageToBox(p: { x: number; y: number }, imageAspect: number, boxAspect: number, fit: LayerFit): { x: number; y: number } {
  const out = imageToBoxRaw(p, imageAspect, boxAspect, fit);
  return { x: Math.max(0, Math.min(1, out.x)), y: Math.max(0, Math.min(1, out.y)) };
}
