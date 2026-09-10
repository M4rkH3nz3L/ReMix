import type { ClipKeyframes, Keyframe, VideoClip } from '@/types/project';

/**
 * Auto Reframe (P0‑7) — pure mag: a worker adta forrás-normalizált téma-útvonal
 * lefordítása a MEGLÉVŐ vászon-transzform kulcskockákra: cover-scale (a videó
 * kitölti a vásznat) + animált x/y pan, hogy a téma középen maradjon. Így az
 * előnézet és a render változtatás nélkül működik (P0‑5 pipeline).
 */

export interface ReframePoint {
  /** a klip-ablak elejétől eltelt FORRÁS-idő (mp) */
  t: number;
  /** forrás-normalizált középpont */
  x: number;
  y: number;
}

/**
 * Cover-scale a transform-szemantikánkban: scale=1 a contain-illesztés, a
 * cover-hez a rövidebb irányt kell felhúzni a vászonra.
 */
export function coverScaleFor(srcAspect: number, canvasAspect: number): number {
  if (!Number.isFinite(srcAspect) || !Number.isFinite(canvasAspect)) {
    return 1;
  }
  return srcAspect > canvasAspect
    ? srcAspect / canvasAspect
    : canvasAspect / srcAspect;
}

/** a contain-illesztett videó megjelenített mérete a vászon arányában (w,h ≤ 1) */
function containSize(srcAspect: number, canvasAspect: number): { w: number; h: number } {
  return srcAspect > canvasAspect
    ? { w: 1, h: canvasAspect / srcAspect }
    : { w: srcAspect / canvasAspect, h: 1 };
}

/**
 * Egy forrás-pont vászonra centrálásához szükséges x/y eltolás (a vászon
 * arányában), a szélek klippelésével (a crop-ablak nem lóghat ki a videóból).
 */
export function panToCenter(
  subject: { x: number; y: number },
  srcAspect: number,
  canvasAspect: number,
  scale: number
): { x: number; y: number } {
  const { w, h } = containSize(srcAspect, canvasAspect);
  const dispW = w * scale;
  const dispH = h * scale;
  const maxX = Math.max(0, (dispW - 1) / 2);
  const maxY = Math.max(0, (dispH - 1) / 2);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return {
    x: clamp(-(subject.x - 0.5) * dispW, maxX),
    y: clamp(-(subject.y - 0.5) * dispH, maxY),
  };
}

/**
 * Téma-útvonal → transform-kulcskockák a klipre. A pontok forrás-időben
 * jönnek (a klip látható ablakának elejétől); idővonalra 1/speed skáláz.
 * Ritkítva (~2/mp), lineáris easinggel (az EMA már simított).
 */
export function pathToReframeKeyframes(
  points: ReframePoint[],
  srcAspect: number,
  canvasAspect: number,
  speed: number,
  stepSec = 0.5
): ClipKeyframes {
  const scale = Math.min(coverScaleFor(srcAspect, canvasAspect), 4);
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  let lastT = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isEdge = i === 0 || i === points.length - 1;
    if (!isEdge && p.t - lastT < stepSec) {
      continue;
    }
    lastT = p.t;
    const time = p.t / Math.max(speed, 0.01);
    const pan = panToCenter(p, srcAspect, canvasAspect, scale);
    x.push({ time, value: pan.x, easing: 'linear' });
    y.push({ time, value: pan.y, easing: 'linear' });
  }
  return {
    scale: [{ time: 0, value: scale, easing: 'linear' }],
    x,
    y,
  };
}

/** kell-e egyáltalán reframe (az arányok ~egyeznek → nem) */
export function needsReframe(srcAspect: number, canvasAspect: number): boolean {
  return coverScaleFor(srcAspect, canvasAspect) > 1.05;
}

/** a klip látható forrás-ablaka (mp) — a /reframe kérés paraméterei */
export function sourceWindow(clip: VideoClip): { startSec: number; durationSec: number } {
  return { startSec: clip.trimIn, durationSec: clip.duration * clip.speed };
}
