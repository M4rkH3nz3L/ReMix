import type { Clip, Keyframe, Project, ShapeClip } from '@/types/project';

/**
 * 🔊 Beat FX (P0‑2 bővítés): beat-re időzített zoom-pulzus és flash — a
 * meglévő beat-rácsra és a kulcskocka-motorra fordul, így előnézetben és
 * renderben azonnal él. Pure, tesztelhető.
 */

const MIN_GAP = 0.05; // pulzus a klip-szélektől / egymástól ennyire tartson

export interface BeatPulsePlan {
  clips: Clip[];
  pulses: number;
  /** kulcskockás klipek, amiket nem bántottunk */
  skipped: number;
}

/**
 * Zoom-pulzus a megadott (idővonal-idejű) beatekre: a videó/kép klipek scale
 * csatornája minden beatnél felugrik (base·(1+intensity)), majd decay alatt
 * visszaáll. A már kulcskockás klipek kimaradnak (skipped). A pulzus-szám
 * felülről korlátos — a render kifejezés-lánca ne nőjön a plafonig.
 */
export function buildBeatPulsePlan(
  project: Project,
  beatTimes: number[],
  opts: { intensity?: number; decay?: number; maxPulses?: number } = {}
): BeatPulsePlan | null {
  const intensity = opts.intensity ?? 0.1;
  const decay = opts.decay ?? 0.22;
  const maxPulses = opts.maxPulses ?? 160;
  const track = project.tracks.find((t) => t.type === 'video');
  if (!track || beatTimes.length === 0) {
    return null;
  }
  const sorted = [...beatTimes].sort((a, b) => a - b).slice(0, maxPulses);
  let pulses = 0;
  let skipped = 0;
  const clips = track.clips.map((clip) => {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      return clip;
    }
    if (clip.keyframes) {
      skipped += 1;
      return clip;
    }
    const base = clip.transform?.scale ?? 1;
    const clipEnd = clip.start + clip.duration;
    const scale: Keyframe[] = [{ time: 0, value: base, easing: 'linear' }];
    let lastEnd = 0;
    for (const t of sorted) {
      const tc = t - clip.start;
      if (tc < MIN_GAP || t > clipEnd - decay - MIN_GAP) {
        continue;
      }
      if (tc < lastEnd + MIN_GAP) {
        continue; // az előző pulzus lecsengése még tart
      }
      scale.push({ time: tc, value: base * (1 + intensity), easing: 'easeOut' });
      scale.push({ time: tc + decay, value: base, easing: 'linear' });
      lastEnd = tc + decay;
      pulses += 1;
    }
    if (scale.length === 1) {
      return clip;
    }
    return { ...clip, keyframes: { scale } };
  });
  if (pulses === 0) {
    return null;
  }
  return { clips, pulses, skipped };
}

export interface BeatFlashPlan {
  clips: Clip[];
  flashes: number;
}

/**
 * Flash a downbeatekre: rövid, teljes-vásznas fehér villanás az overlay-sávon
 * (a meglévő forma-render viszi előnézetben és renderben). A meglévő
 * overlay-klipek maradnak; egy undo-lépéses REPLACE-hez a teljes lista megy.
 */
export function buildBeatFlashPlan(
  project: Project,
  downbeats: number[],
  makeIdFn: () => string,
  opts: { duration?: number; opacity?: number; maxFlashes?: number } = {}
): BeatFlashPlan | null {
  const duration = opts.duration ?? 0.12;
  const opacity = opts.opacity ?? 0.4;
  const maxFlashes = opts.maxFlashes ?? 80;
  const track = project.tracks.find((t) => t.type === 'overlay');
  const videoEnd = Math.max(
    0,
    ...project.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .map((c) => c.start + c.duration)
  );
  if (videoEnd === 0 || downbeats.length === 0) {
    return null;
  }
  const flashes: ShapeClip[] = [];
  for (const t of [...downbeats].sort((a, b) => a - b)) {
    if (t < MIN_GAP || t + duration > videoEnd) {
      continue;
    }
    if (flashes.length >= maxFlashes) {
      break;
    }
    flashes.push({
      kind: 'shape',
      id: makeIdFn(),
      start: t,
      duration,
      shape: 'rectangle',
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fill: '#ffffff',
      opacity,
    });
  }
  if (flashes.length === 0) {
    return null;
  }
  const existing = track?.clips ?? [];
  return {
    clips: [...existing, ...flashes].sort((a, b) => a.start - b.start),
    flashes: flashes.length,
  };
}
