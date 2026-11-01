import type { ImageDoc } from '@/types/project';

/** 🛡️ A szerver `imageDocGuard` korlátjainak tükre: a túl nagy dokumentum feltöltés nélkül is kiderül. */
export const MAX_DOC_LAYERS = 400;
export const MAX_DOC_POINTS = 200000;

type Loose = { points?: unknown[]; subpaths?: unknown[][]; mask?: { ops?: { points?: unknown[] }[] }; localAdjust?: { mask?: { ops?: { points?: unknown[] }[] } } };

export function docPointCount(doc: ImageDoc): number {
  let points = 0;
  for (const raw of doc.layers) {
    const l = raw as unknown as Loose;
    for (const mask of [l.mask, l.localAdjust?.mask]) {
      for (const op of mask?.ops ?? []) {
        points += op.points?.length ?? 0;
      }
    }
    points += l.points?.length ?? 0;
    for (const sp of l.subpaths ?? []) {
      points += sp.length;
    }
  }
  return points;
}

export function docLimitProblem(doc: ImageDoc): 'layers' | 'points' | null {
  if (doc.layers.length > MAX_DOC_LAYERS) {
    return 'layers';
  }
  return docPointCount(doc) > MAX_DOC_POINTS ? 'points' : null;
}
