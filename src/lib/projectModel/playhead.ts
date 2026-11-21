import { clipEnd, trackOf } from '@/lib/projectModel/queries';
import type { AdjustClip, Clip, ImageClip, Project, Track, VideoClip } from '@/types/project';

/** A t időpontban aktív klipek egy sávon (start ≤ t < vég). */
export function clipsAt<T extends Clip>(track: Track, t: number): T[] {
  return track.clips.filter((c) => c.start <= t && t < clipEnd(c)) as T[];
}

/** Az előnézetben megjelenő videó/kép klip: az átfedők közül a legkésőbb kezdődő. */
export function activeVisualClip(project: Project, t: number): Clip | null {
  const track = trackOf(project, 'video');
  const active = clipsAt(track, t);
  if (active.length === 0) {
    return null;
  }
  return active.reduce((a, b) => (b.start >= a.start ? b : a));
}

/**
 * A playheadnél SOON-következő vizuális klip (gapless-előnézethez, EDITOR-UX §2.6):
 * a videó-sávon a legközelebbi, `t` UTÁN kezdődő video/kép klip, ha a `lookaheadSec`
 * ablakba esik. A preview egy második, előre-bufferelt playerrel így a klip-határon
 * kattanás nélkül válthat (a tényleges double-buffer a preview-rétegben, eszközön).
 * `null`, ha nincs ilyen, vagy még túl messze van (akkor ne foglaljunk playert).
 */
export function upcomingVisualClip(
  project: Project,
  t: number,
  lookaheadSec = 1
): VideoClip | ImageClip | null {
  const track = trackOf(project, 'video');
  let best: VideoClip | ImageClip | null = null;
  for (const c of track.clips) {
    if (c.kind !== 'video' && c.kind !== 'image') {
      continue;
    }
    if (c.start <= t || c.start > t + lookaheadSec) {
      continue; // már (majdnem) aktív, vagy még túl messze
    }
    if (!best || c.start < best.start) {
      best = c;
    }
  }
  return best;
}

/** A t-nél épp folyó átmenet (kimenő A klip utolsó `d` mp-ében) — az előnézethez. */
export interface ActiveTransition {
  from: VideoClip | ImageClip;
  to: VideoClip | ImageClip;
  type: NonNullable<VideoClip['transitionOut']>['type'];
  /** 🧭 irány (az irányos előnézet-variánst választja, a render-rel paritásban) */
  direction?: NonNullable<VideoClip['transitionOut']>['direction'];
  /** 0 → 1 az átmenet-ablakban */
  progress: number;
}

/**
 * A lejátszófejnél épp folyó klip-átmenet: ha egy vizuális klip `transitionOut`-ja
 * a saját utolsó `d` mp-ébe esik és van rákövetkező klip, visszaadja a kimenő (A)
 * és a bejövő (B) klipet + a 0–1 haladást. A fő preview ezt kereszttűnéssel /
 * csúszással közelíti; a pontos xfade a renderben ég be.
 */
export function activeTransition(project: Project, t: number): ActiveTransition | null {
  const track = project.tracks.find((tr) => tr.type === 'video');
  if (!track) {
    return null;
  }
  const clips = (track.clips as Clip[])
    .filter((c): c is VideoClip | ImageClip => c.kind === 'video' || c.kind === 'image')
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < clips.length - 1; i++) {
    const from = clips[i];
    const tr = from.transitionOut;
    if (!tr) {
      continue;
    }
    const end = from.start + from.duration;
    const d = Math.max(0.1, Math.min(tr.duration, from.duration));
    if (t >= end - d && t < end) {
      return {
        from,
        to: clips[i + 1],
        type: tr.type,
        direction: tr.direction,
        progress: Math.max(0, Math.min(1, (t - (end - d)) / d)),
      };
    }
  }
  return null;
}

/** A lejátszófejnél aktív PiP-klip (a legutóbb kezdődő) — az előnézeti 2. réteghez. */
export function activePipClip(project: Project, t: number): VideoClip | ImageClip | null {
  const active = activePipClips(project, t);
  return active.length > 0 ? active[active.length - 1] : null;
}

/**
 * A t időpontban aktív ÖSSZES PiP-klip, idősorrendben (a később kezdődő rendereli
 * felül — a render-overlay sorrendjével egyezően). Több egyidejű PiP-hez.
 */
export function activePipClips(project: Project, t: number): (VideoClip | ImageClip)[] {
  // védett: a régi (migráció nélküli) projektekben hiányozhat a pip-sáv
  const track = project.tracks.find((tr) => tr.type === 'pip');
  if (!track) {
    return [];
  }
  return clipsAt(track, t)
    .filter((c): c is VideoClip | ImageClip => c.kind === 'video' || c.kind === 'image')
    .sort((a, b) => a.start - b.start);
}

/**
 * A t időpontban aktív grade-rétegek (adjust-klipek) — az előnézeti tint-
 * közelítéshez és a render enable-ablakaihoz. Idősorrendben.
 */
export function activeAdjustClips(project: Project, t: number): AdjustClip[] {
  const track = project.tracks.find((tr) => tr.type === 'adjust');
  if (!track) {
    return [];
  }
  return clipsAt<AdjustClip>(track, t).sort((a, b) => a.start - b.start);
}

/**
 * Idővonal-idő → forrásfájl-idő egy videóklipen belül.
 * ⏪ `reversed`: a trimmelt forrás-szakasz visszafelé (a végéről az elejére).
 */
export function sourceTimeAt(clip: VideoClip, t: number): number {
  const local = t - clip.start;
  if (clip.reversed) {
    // t=start → az UTOLSÓ használt kocka (trimIn + hossz*speed); t=end → trimIn
    return clip.trimIn + (clip.duration - local) * clip.speed;
  }
  return clip.trimIn + local * clip.speed;
}
