/**
 * 🧊 3D-geometria mag (3D-Studio.md §4) — vektor, kvaternió, transzformáció,
 * befoglaló doboz, mértékegység. Expo-mentes, mellékhatás nélküli → Jest-tel
 * önmagában tesztelhető; a natív néző és a stúdió-UI erre épül.
 *
 * Konvenció: jobbkezes koordináta-rendszer, +Y felfelé (mint ARKit/RealityKit/
 * SceneKit), hossz méterben, szög radiánban.
 */
import type { Bounds3, Quat, Transform3, Vec3 } from '@/types/model3d';

export const EPS = 1e-9;

// ── Vektor ────────────────────────────────────────────────────────────────────
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const mul = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < EPS ? vec3() : scale(a, 1 / l);
}
export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

// ── Kvaternió ─────────────────────────────────────────────────────────────────
export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return l < EPS ? quatIdentity() : { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** forgatás `axis` (normalizált) körül `angle` radiánnal */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return quatNormalize({ x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) });
}

/** a·b: előbb `b`, aztán `a` forgatás */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** a `v` vektor elforgatása a `q` kvaternióval */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return add(v, add(scale(uv, 2 * q.w), scale(uuv, 2)));
}

/** gömbi lineáris interpoláció (a rövidebb úton) */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cos > 0.9995) {
    return quatNormalize({
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
      w: a.w + (bb.w - a.w) * t,
    });
  }
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return { x: a.x * wa + bb.x * wb, y: a.y * wa + bb.y * wb, z: a.z * wa + bb.z * wb, w: a.w * wa + bb.w * wb };
}

// ── Transzformáció ────────────────────────────────────────────────────────────
export const identityTransform = (): Transform3 => ({
  position: vec3(),
  rotation: quatIdentity(),
  scale: vec3(1, 1, 1),
});

/** pont a lokálisból világba: skála → forgatás → eltolás */
export function transformPoint(t: Transform3, p: Vec3): Vec3 {
  return add(rotateVec(t.rotation, mul(t.scale, p)), t.position);
}

/** egyenletes (uniform) skála beállítása, a 0 alá menést tiltva */
export function withUniformScale(t: Transform3, k: number): Transform3 {
  const s = Math.max(1e-4, k);
  return { ...t, scale: vec3(s, s, s) };
}

// ── Befoglaló doboz ───────────────────────────────────────────────────────────
export function boundsFromPoints(points: Vec3[]): Bounds3 | null {
  if (points.length === 0) {
    return null;
  }
  const min = { ...points[0] };
  const max = { ...points[0] };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

export function boundsCorners(b: Bounds3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

/** a lokális doboz világ-befoglalója (a 8 sarok transzformálva — forgatásnál is helyes) */
export function transformBounds(t: Transform3, b: Bounds3): Bounds3 {
  return boundsFromPoints(boundsCorners(b).map((p) => transformPoint(t, p))) as Bounds3;
}

export function boundsUnion(list: Bounds3[]): Bounds3 | null {
  return boundsFromPoints(list.flatMap((b) => [b.min, b.max]));
}

export const boundsCenter = (b: Bounds3): Vec3 => scale(add(b.min, b.max), 0.5);
export const boundsSize = (b: Bounds3): Vec3 => sub(b.max, b.min);
/** a doboz átlójának fele — a „fit to view" és a kamera-távolság alapja */
export const boundsRadius = (b: Bounds3): number => length(boundsSize(b)) / 2;

// ── Mértékegység ──────────────────────────────────────────────────────────────
export type LengthUnit = 'm' | 'cm' | 'mm' | 'in' | 'ft';
const PER_METER: Record<LengthUnit, number> = { m: 1, cm: 100, mm: 1000, in: 39.3700787, ft: 3.2808399 };

export function convertLength(meters: number, unit: LengthUnit): number {
  return meters * PER_METER[unit];
}

/**
 * Ember-olvasható hossz: automatikus egység (metrikusan cm 1 m alatt, mm 1 cm alatt),
 * vagy a megadott egység; értelmes tizedes-pontossággal.
 */
export function formatLength(meters: number, unit: LengthUnit | 'auto' = 'auto'): string {
  const u: LengthUnit =
    unit !== 'auto' ? unit : Math.abs(meters) >= 1 ? 'm' : Math.abs(meters) >= 0.01 ? 'cm' : 'mm';
  const v = convertLength(meters, u);
  const digits = u === 'm' || u === 'ft' ? 2 : u === 'cm' || u === 'in' ? 1 : 0;
  return `${v.toFixed(digits)} ${u}`;
}
