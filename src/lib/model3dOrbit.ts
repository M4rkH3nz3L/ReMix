/**
 * 🎥 Orbit-kamera (3D-Studio.md §8.1) — a néző forgatás/nagyítás/eltolás logikája
 * gesztusból, korlátokkal; „fit to view" a befoglaló dobozhoz. Pure: a natív néző
 * csak az eredmény-kamerát rajzolja, így a viselkedés tesztelt és platformfüggetlen.
 *
 * Gömbi koordináták a `target` körül: yaw (vízszintes), pitch (függőleges,
 * ±85°-ra korlátozva, hogy a kamera ne forduljon át a pólusokon), distance (m).
 */
import { add, boundsCenter, boundsRadius, rotateVec, scale, quatFromAxisAngle, vec3 } from '@/lib/model3d';
import type { Bounds3, OrbitCamera, Vec3 } from '@/types/model3d';

export const ORBIT_LIMITS = {
  pitchMax: (85 * Math.PI) / 180,
  minDistance: 0.05,
  maxDistance: 200,
  /** radián / képpont húzás */
  rotateSensitivity: 0.008,
  defaultFov: 45,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** yaw a (−π, π] tartományba */
export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

export function clampOrbit(c: OrbitCamera): OrbitCamera {
  return {
    ...c,
    yaw: wrapAngle(c.yaw),
    pitch: clamp(c.pitch, -ORBIT_LIMITS.pitchMax, ORBIT_LIMITS.pitchMax),
    distance: clamp(c.distance, ORBIT_LIMITS.minDistance, ORBIT_LIMITS.maxDistance),
  };
}

export function defaultOrbit(target: Vec3 = vec3()): OrbitCamera {
  return { yaw: Math.PI / 6, pitch: Math.PI / 9, distance: 1.5, target, fov: ORBIT_LIMITS.defaultFov };
}

/** 1 ujjas húzás (dx, dy képpontban) → forgatás; jobbra húzás = a modell jobbra fordul */
export function orbitRotate(c: OrbitCamera, dx: number, dy: number): OrbitCamera {
  const k = ORBIT_LIMITS.rotateSensitivity;
  return clampOrbit({ ...c, yaw: c.yaw - dx * k, pitch: c.pitch + dy * k });
}

/** csippentés: `pinchScale` > 1 = közelít (a távolság osztódik) */
export function orbitZoom(c: OrbitCamera, pinchScale: number): OrbitCamera {
  return clampOrbit({ ...c, distance: c.distance / Math.max(0.01, pinchScale) });
}

/** a kamera világ-pozíciója */
export function cameraPosition(c: OrbitCamera): Vec3 {
  const cp = Math.cos(c.pitch);
  return add(c.target, {
    x: c.distance * cp * Math.sin(c.yaw),
    y: c.distance * Math.sin(c.pitch),
    z: c.distance * cp * Math.cos(c.yaw),
  });
}

/**
 * 2 ujjas eltolás: a célpontot a KAMERA síkjában mozgatja (jobbra/fel), a
 * távolsággal arányosan — közelről finom, távolról gyors (természetes érzet).
 * `viewportH`: a néző magassága képpontban.
 */
export function orbitPan(c: OrbitCamera, dx: number, dy: number, viewportH: number): OrbitCamera {
  const worldPerPx = (2 * c.distance * Math.tan(((c.fov * Math.PI) / 180) / 2)) / Math.max(1, viewportH);
  const yawQ = quatFromAxisAngle(vec3(0, 1, 0), c.yaw);
  const right = rotateVec(yawQ, vec3(1, 0, 0));
  const up = vec3(0, 1, 0);
  const move = add(scale(right, -dx * worldPerPx), scale(up, dy * worldPerPx));
  return { ...c, target: add(c.target, move) };
}

/**
 * „Illeszd a nézetbe": a célpont a doboz közepe, a távolság akkora, hogy a doboz
 * köré írt gömb kiférjen a SZŰKEBB látószögbe (álló képernyőn a vízszintes), kis ráhagyással.
 */
export function fitToBounds(c: OrbitCamera, b: Bounds3, aspect: number, margin = 1.15): OrbitCamera {
  const r = Math.max(boundsRadius(b), 0.01);
  const vfov = (c.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.1, aspect));
  const fov = Math.min(vfov, hfov);
  const d = (r * margin) / Math.sin(fov / 2);
  return clampOrbit({ ...c, target: boundsCenter(b), distance: d });
}
