/**
 * 🎬 Kamerapálya a „Videó a modellből" exporthoz (3D-Studio.md §8.1) — körbeforgó
 * (turntable) és mentett nézetek közti pálya; képkockánkénti kamera-mintavétel a
 * projekt fps-ével. Pure: a natív `renderClip` csak a kész kamera-listát rendereli.
 */
import { lerpVec } from '@/lib/model3d';
import { clampOrbit, wrapAngle } from '@/lib/model3dOrbit';
import type { OrbitCamera } from '@/types/model3d';

export type Easing = 'linear' | 'easeInOut';

export function ease(t: number, kind: Easing): number {
  const x = Math.min(1, Math.max(0, t));
  return kind === 'linear' ? x : x * x * (3 - 2 * x); // smoothstep
}

/** a képkockák száma a frame-rácson (legalább 1) */
export function frameCount(seconds: number, fps: number): number {
  return Math.max(1, Math.round(Math.max(0, seconds) * Math.max(1, fps)));
}

/** két orbit-kamera interpolációja — a yaw a RÖVIDEBB úton fordul */
export function interpolateOrbit(a: OrbitCamera, b: OrbitCamera, t: number): OrbitCamera {
  const dYaw = wrapAngle(b.yaw - a.yaw);
  return clampOrbit({
    yaw: a.yaw + dYaw * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    target: lerpVec(a.target, b.target, t),
    fov: a.fov + (b.fov - a.fov) * t,
  });
}

export interface TurntableOptions {
  seconds: number;
  fps: number;
  /** ív fokban (360 = teljes kör) */
  degrees?: number;
  /** +1 = az óramutatóval egyező (felülről nézve), −1 = ellentétes */
  direction?: 1 | -1;
  easing?: Easing;
}

/**
 * Körbeforgó pálya: a kiinduló kamerából a yaw `degrees`-szel fordul. Teljes körnél
 * az utolsó képkocka NEM esik egybe az elsővel (t a [0, 1) tartományban) → a klip
 * hurokban lejátszva akadásmentes.
 */
export function turntablePath(start: OrbitCamera, opts: TurntableOptions): OrbitCamera[] {
  const n = frameCount(opts.seconds, opts.fps);
  const deg = opts.degrees ?? 360;
  const loop = Math.abs(deg) >= 360;
  const total = ((deg * Math.PI) / 180) * (opts.direction ?? 1);
  const easing = opts.easing ?? (loop ? 'linear' : 'easeInOut');
  const out: OrbitCamera[] = [];
  for (let i = 0; i < n; i++) {
    const t = loop ? i / n : n === 1 ? 0 : i / (n - 1);
    out.push(clampOrbit({ ...start, yaw: start.yaw - total * ease(t, easing) }));
  }
  return out;
}

/**
 * Nézetek közti pálya: a szakaszok egyenlő időt kapnak, mindegyik easinggel
 * (a kamera a kulcsnézetekben „megpihen"). Egy nézetnél állókép-pálya.
 */
export function viewsPath(views: OrbitCamera[], seconds: number, fps: number, easing: Easing = 'easeInOut'): OrbitCamera[] {
  const n = frameCount(seconds, fps);
  if (views.length === 0) {
    return [];
  }
  if (views.length === 1) {
    return Array.from({ length: n }, () => views[0]);
  }
  const segs = views.length - 1;
  const out: OrbitCamera[] = [];
  for (let i = 0; i < n; i++) {
    const g = n === 1 ? 0 : (i / (n - 1)) * segs;
    const seg = Math.min(segs - 1, Math.floor(g));
    out.push(interpolateOrbit(views[seg], views[seg + 1], ease(g - seg, easing)));
  }
  return out;
}
