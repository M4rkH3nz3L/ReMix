
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { ensureCloud } from '@/lib/backend';

/**
 * 🙂 Arc-detektor kliens: a worker /faces végpontja egy képkocka arcait adja
 * — a dobozok a vászon-arányra normalizáltak, így közvetlenül használhatók
 * pozicionáláshoz és a tracker indítópontjának.
 */

export interface FaceBox {
  /** középpont, vászon-normalizálva */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export async function fetchFaces(
  uri: string,
  opts: { atSec?: number; aspectW: number; aspectH: number }
): Promise<FaceBox[] | null> {
  const base = ensureCloud('faceTools');
  try {
    const form = await mediaFormData(uri);
    form.append('atSec', String(Math.max(0, opts.atSec ?? 0)));
    form.append('aspectW', String(opts.aspectW));
    form.append('aspectH', String(opts.aspectH));
    const res = await uploadFetch(`${base}/faces`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { faces: FaceBox[] };
    return Array.isArray(body.faces) ? body.faces : null;
  } catch {
    return null;
  }
}

/** a legerősebb (pontszám·terület) arc — a követés természetes célpontja */
export function pickPrimaryFace(faces: FaceBox[]): FaceBox | null {
  if (faces.length === 0) {
    return null;
  }
  return [...faces].sort((a, b) => b.score * b.w * b.h - a.score * a.w * a.h)[0];
}

// a pure régió-számítás külön modulban (tsx-tesztelhetőség), innen is elérhető
export { faceUnionRegion } from '@/lib/faceRegion';
