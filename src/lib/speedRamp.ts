import type { Clip, Project, VideoClip } from '@/types/project';

/**
 * 🚀 Speed ramping (P1): a klip sebessége egy preset-görbe szerint változik —
 * a ramp DARABOKRA VÁGOTT, lépcsős sebességű klipekre fordul le (a meglévő
 * speed-motorra), így az előnézet, a render, a hang (atempo) és a feliratok
 * időzítése új motor nélkül, azonnal helyes. A klip idővonal-hossza NEM
 * változik: a görbe úgy normalizálódik, hogy a darabok össz-hossza pontosan
 * az eredeti maradjon (a többi sáv nem csúszik). Pure, tesztelhető.
 */

export type SpeedRampPreset = 'hero' | 'bullet' | 'montage' | 'flashIn' | 'easeOut';

/** az egyéni görbe-szerkesztő korlátai (a szegmens-szorzókra) */
export const CURVE_MIN = 0.2;
export const CURVE_MAX = 4;
export const CURVE_MIN_SEGMENTS = 2;
export const CURVE_MAX_SEGMENTS = 8;

/** a görbe a klip saját sebességéhez képesti szorzók sora (egyenlő forrás-szakaszokon) */
export const SPEED_RAMP_PRESETS: {
  id: SpeedRampPreset;
  label: string;
  curve: number[];
}[] = [
  { id: 'hero', label: '🦸 Hero', curve: [1.6, 1.2, 0.45, 0.45, 1.2, 1.6] },
  { id: 'bullet', label: '🔫 Bullet time', curve: [1.5, 1.5, 0.25, 0.25, 1.5, 1.5] },
  { id: 'montage', label: '🎞️ Montázs', curve: [0.65, 0.85, 1.1, 1.5, 2.1] },
  { id: 'flashIn', label: '⚡ Berántás', curve: [3, 1.7, 0.95, 0.8, 0.8] },
  { id: 'easeOut', label: '🐢 Lassú zárás', curve: [1.8, 1.3, 0.95, 0.65, 0.5] },
];

/**
 * A ramp darabjai: a klip forrás-szakasza K egyenlő részre oszlik, a k-adik
 * darab sebessége speed·curve[k], majd minden sebesség úgy skálázódik, hogy a
 * darabok idővonal-hossza összesen az eredeti klip-hossz legyen.
 * A kulcskockák nem vihetők át darabokra (v1) — a hívó figyelmeztet rájuk.
 */
/** a görbe feloldása: preset-azonosító VAGY nyers szorzó-sor (egyéni görbe) */
export function resolveCurve(
  curveOrPreset: SpeedRampPreset | number[]
): number[] | null {
  if (Array.isArray(curveOrPreset)) {
    // az egyéni görbe a szerkesztőből jön — védjük ki a hibás bemenetet
    const clean = curveOrPreset
      .filter((v) => Number.isFinite(v) && v > 0)
      .map((v) => Math.min(8, Math.max(0.1, v)));
    return clean.length >= 2 ? clean : null;
  }
  return SPEED_RAMP_PRESETS.find((p) => p.id === curveOrPreset)?.curve ?? null;
}

export function buildSpeedRampPieces(
  clip: VideoClip,
  curveOrPreset: SpeedRampPreset | number[],
  makeIdFn: () => string,
  motionBlur = 0
): VideoClip[] | null {
  const curve = resolveCurve(curveOrPreset);
  if (!curve || clip.duration < 0.6) {
    return null;
  }
  const spec = { curve };
  const K = spec.curve.length;
  const srcSpan = clip.duration * clip.speed;
  const chunkSrc = srcSpan / K;

  // nyers hosszak → normalizáló szorzó a sebességekre
  const rawSpeeds = spec.curve.map((c) => clip.speed * c);
  const rawTotal = rawSpeeds.reduce((sum, s) => sum + chunkSrc / s, 0);
  const factor = rawTotal / clip.duration;

  const pieces: VideoClip[] = [];
  let start = clip.start;
  for (let k = 0; k < K; k++) {
    const speed = Math.min(10, Math.max(0.1, rawSpeeds[k] * factor));
    const last = k === K - 1;
    // az utolsó darab pontosan az eredeti klip-végig ér (lebegőpontos hibák ellen)
    const duration = last ? clip.start + clip.duration - start : chunkSrc / speed;
    if (duration <= 0.01) {
      return null; // elfajult görbe/clamp — inkább nem alkalmazzuk
    }
    pieces.push({
      ...clip,
      id: makeIdFn(),
      start,
      duration,
      trimIn: clip.trimIn + k * chunkSrc,
      speed: last ? (chunkSrc / duration > 0 ? chunkSrc / duration : speed) : speed,
      // a szél-effektek a szélső darabokra kerülnek, a többiről lekerülnek
      fadeInSec: k === 0 ? clip.fadeInSec : undefined,
      fadeOutSec: last ? clip.fadeOutSec : undefined,
      transitionOut: last ? clip.transitionOut : undefined,
      // 🌀 a gyors darabok elmosódnak, a lassúak interpolálva simulnak
      motionBlur: motionBlur > 0 ? motionBlur : clip.motionBlur,
      // kulcskockás mozgás darabolása a v1-ben nem támogatott
      keyframes: undefined,
    });
    start += duration;
  }
  return pieces;
}

/** a videósáv új klip-listája: a rampelt klip helyén a darabjai */
export function buildSpeedRampPlan(
  project: Project,
  clipId: string,
  curveOrPreset: SpeedRampPreset | number[],
  makeIdFn: () => string,
  motionBlur = 0
): { clips: Clip[]; pieces: number } | null {
  const track = project.tracks.find((t) => t.type === 'video');
  const target = track?.clips.find((c) => c.id === clipId);
  if (!track || !target || target.kind !== 'video') {
    return null;
  }
  const pieces = buildSpeedRampPieces(target, curveOrPreset, makeIdFn, motionBlur);
  if (!pieces) {
    return null;
  }
  const clips = track.clips
    .flatMap((c) => (c.id === clipId ? pieces : [c]))
    .sort((a, b) => a.start - b.start);
  return { clips, pieces: pieces.length };
}
