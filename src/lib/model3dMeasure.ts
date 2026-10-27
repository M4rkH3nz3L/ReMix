/**
 * 📏 3D-mérés (3D-Studio.md §4, §6) — valós méretarányú (méter) távolság, poligon-
 * terület, kerület, térfogat-becslés. A LiDAR-szken valós méretet ad, ezért ezek a
 * számok a felhasználónak ténylegesen jelentenek valamit (bútor, szoba, termék).
 */
import { boundsSize, cross, distance, length, sub, vec3 } from '@/lib/model3d';
import type { Bounds3, Model3DMeasurement, Vec3 } from '@/types/model3d';

/** két pont távolsága (m) */
export const pointDistance = distance;

/** egymás utáni pontok összhossza (nyitott vonallánc) */
export function polylineLength(points: Vec3[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += distance(points[i - 1], points[i]);
  }
  return sum;
}

/** zárt poligon kerülete */
export function polygonPerimeter(points: Vec3[]): number {
  return points.length < 2 ? 0 : polylineLength([...points, points[0]]);
}

/**
 * Síkbeli 3D-poligon területe (m²) — Newell-módszer: a terület a normálvektor
 * hosszának fele; bármilyen orientációjú síkon működik (padló, fal, ferde felület).
 */
export function polygonArea(points: Vec3[]): number {
  if (points.length < 3) {
    return 0;
  }
  let n = vec3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = cross(a, b);
    n = { x: n.x + c.x, y: n.y + c.y, z: n.z + c.z };
  }
  return length(n) / 2;
}

/** a befoglaló doboz térfogata (m³) — felső becslés a tárgy méretére */
export function boundsVolume(b: Bounds3): number {
  const s = boundsSize(b);
  return Math.max(0, s.x) * Math.max(0, s.y) * Math.max(0, s.z);
}

/** a mérés értéke a fajtája szerint (distance: m, area: m²) — érvénytelennél null */
export function measurementValue(m: Model3DMeasurement): number | null {
  if (m.kind === 'distance') {
    return m.points.length === 2 ? pointDistance(m.points[0], m.points[1]) : null;
  }
  return m.points.length >= 3 ? polygonArea(m.points) : null;
}

/** ember-olvasható terület */
export function formatArea(m2: number): string {
  return m2 >= 1 ? `${m2.toFixed(2)} m²` : `${(m2 * 10000).toFixed(0)} cm²`;
}

/** a pont-pont mérés középpontja (a címke helye a nézőben) */
export function measurementLabelAt(m: Model3DMeasurement): Vec3 | null {
  if (m.points.length === 0) {
    return null;
  }
  const s = m.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), vec3());
  const k = 1 / m.points.length;
  return { x: s.x * k, y: s.y * k, z: s.z * k };
}

/** a mérés síkja normál-e (területnél) — a néző ehhez igazítja a címkét */
export function polygonNormal(points: Vec3[]): Vec3 | null {
  if (points.length < 3) {
    return null;
  }
  const n = cross(sub(points[1], points[0]), sub(points[2], points[0]));
  const l = length(n);
  return l < 1e-9 ? null : { x: n.x / l, y: n.y / l, z: n.z / l };
}
