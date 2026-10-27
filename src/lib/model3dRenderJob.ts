/**
 * 🖼️🎬 „Kép/Videó a modellből" render-feladat validálása (3D-Studio.md §8.1).
 *
 * Kiszámolja a kimeneti méretet (a cél-projekt képarányához és a felbontás-
 * presethez), a képkockaszámot (a frame-rácson), és kiszűri az érvénytelen
 * kombinációkat, MIELŐTT a drága natív render elindul. A hibák i18n-kulcsok.
 */
import { frameCount } from '@/lib/model3dCameraPath';

export type RenderTarget = 'image' | 'video' | 'overlay';
export type ResolutionPreset = '1080' | '1440' | '2160';

export interface RenderJobInput {
  target: RenderTarget;
  /** a cél-projekt képaránya, pl. '9:16' (kép-projektnél a vászon aránya) */
  aspectRatio: string;
  resolution: ResolutionPreset;
  transparent: boolean;
  /** videó/overlay */
  seconds?: number;
  fps?: number;
}

export interface RenderJobPlan {
  width: number;
  height: number;
  frames: number;
  transparent: boolean;
  /** a kimeneti formátum javaslat */
  container: 'png' | 'mp4' | 'mov';
}

export const RENDER_LIMITS = { minSeconds: 1, maxSeconds: 60, minFps: 12, maxFps: 60 } as const;

const SHORT_SIDE: Record<ResolutionPreset, number> = { '1080': 1080, '1440': 1440, '2160': 2160 };

/** 'W:H' → arány (érvénytelennél null) */
export function parseAspect(aspect: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!m) {
    return null;
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** páros méretre kerekítés (a videó-kódolók páros szélességet/magasságot várnak) */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** a kimeneti méret: a RÖVIDEBB oldal = preset, a hosszabb az arányból */
export function outputSize(aspect: number, preset: ResolutionPreset): { width: number; height: number } {
  const short = SHORT_SIDE[preset];
  return aspect >= 1
    ? { width: even(short * aspect), height: even(short) }
    : { width: even(short), height: even(short / aspect) };
}

export function planRenderJob(input: RenderJobInput): { plan: RenderJobPlan | null; errors: string[] } {
  const errors: string[] = [];
  const aspect = parseAspect(input.aspectRatio);
  if (aspect === null) {
    errors.push('model3d.render.errAspect');
  }
  // az átlátszó háttér képnél és overlay-nél értelmes; sima videóklipnél nem (a sáv nem alfás)
  if (input.transparent && input.target === 'video') {
    errors.push('model3d.render.errAlphaVideo');
  }
  let frames = 1;
  if (input.target !== 'image') {
    const s = input.seconds ?? 0;
    const fps = input.fps ?? 0;
    if (s < RENDER_LIMITS.minSeconds || s > RENDER_LIMITS.maxSeconds) {
      errors.push('model3d.render.errSeconds');
    }
    if (fps < RENDER_LIMITS.minFps || fps > RENDER_LIMITS.maxFps) {
      errors.push('model3d.render.errFps');
    }
    frames = frameCount(s, fps);
  }
  if (errors.length > 0 || aspect === null) {
    return { plan: null, errors };
  }
  const { width, height } = outputSize(aspect, input.resolution);
  return {
    plan: {
      width,
      height,
      frames,
      transparent: input.target === 'overlay' ? true : input.transparent,
      container: input.target === 'image' ? 'png' : input.target === 'overlay' ? 'mov' : 'mp4',
    },
    errors: [],
  };
}
