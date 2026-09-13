import type { Keyframe } from '@/types/project';

/**
 * Követés-terv (pure, tesztelhető — a hálózati rész a track.ts-ben):
 * a worker pont-sorából a szöveg/matrica kulcskocka-csatornái épülnek.
 */

export interface TrackPoint {
  /** a szakasz elejétől eltelt FORRÁS-idő (mp) */
  t: number;
  /** vászon-normalizált középpont */
  x: number;
  y: number;
  /** a téma látszó mérete az induláshoz képest (🧊 3D tracking; hiányzó = 1) */
  s?: number;
  score: number;
}

/**
 * Pont-sor → x/y kulcskocka-csatornák DELTA-mozgásként: a réteg az induló
 * pozíciójából indul, és a követett pont elmozdulását veszi át. Ritkítva
 * (~3/mp), lineáris easinggel. 🧊 3D követés: ha a téma látszó mérete érdemben
 * változik (>6%), scale-csatorna is épül — a grafika együtt nő/csökken a
 * közeledő/távolodó témával. Pure — tesztelhető.
 */
export function pointsToPositionKeyframes(
  points: TrackPoint[],
  origin: { x: number; y: number },
  /** kulcskocka-idő eltolás: a szakasz kezdete a klip elejétől (mp) */
  timeOffset: number,
  /** forrás-mp → idővonal-mp szorzó (1/speed) */
  timeScale = 1,
  stepSec = 0.34
): { x: Keyframe[]; y: Keyframe[]; scale?: Keyframe[] } {
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  const scale: Keyframe[] = [];
  const first = points[0];
  let lastT = -Infinity;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isEdge = i === 0 || i === points.length - 1;
    if (!isEdge && p.t - lastT < stepSec) {
      continue;
    }
    lastT = p.t;
    const time = Math.max(0, timeOffset + p.t * timeScale);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    x.push({ time, value: clamp01(origin.x + (p.x - first.x)), easing: 'linear' });
    y.push({ time, value: clamp01(origin.y + (p.y - first.y)), easing: 'linear' });
    const s = Math.max(0.4, Math.min(2.5, (p.s ?? 1) / (first.s ?? 1)));
    scale.push({ time, value: s, easing: 'linear' });
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  // közel állandó méretnél a scale-csatorna elmarad (zajt nem kulcskockázunk)
  return sMax - sMin > 0.06 ? { x, y, scale } : { x, y };
}

/**
 * Pont-sor → transform-PÁSZTÁZÁS (x/y) kulcskockák: mint a pozíció-változat, de
 * a vászon-transzform offsetjéhez (±0.75, KÖZÉP=0) klippel — így a KÉP / 3D-kép
 * / matrica-kép elem a követett objektummal EGYÜTT csúszik. Pure — tesztelhető.
 */
export function pointsToPanKeyframes(
  points: TrackPoint[],
  origin: { x: number; y: number },
  timeOffset: number,
  timeScale = 1,
  stepSec = 0.34
): { x: Keyframe[]; y: Keyframe[]; scale?: Keyframe[] } {
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  const scale: Keyframe[] = [];
  const first = points[0];
  let lastT = -Infinity;
  let sMin = Infinity;
  let sMax = -Infinity;
  const clampPan = (v: number) => Math.max(-0.75, Math.min(0.75, v));
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isEdge = i === 0 || i === points.length - 1;
    if (!isEdge && p.t - lastT < stepSec) {
      continue;
    }
    lastT = p.t;
    const time = Math.max(0, timeOffset + p.t * timeScale);
    x.push({ time, value: clampPan(origin.x + (p.x - first.x)), easing: 'linear' });
    y.push({ time, value: clampPan(origin.y + (p.y - first.y)), easing: 'linear' });
    const s = Math.max(0.4, Math.min(2.5, (p.s ?? 1) / (first.s ?? 1)));
    scale.push({ time, value: s, easing: 'linear' });
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  return sMax - sMin > 0.06 ? { x, y, scale } : { x, y };
}
