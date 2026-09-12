import type { LibraryTrack } from '@/lib/render';
import { clamp } from '@/lib/time';
import type { Project, VideoClip } from '@/types/project';

/**
 * 🎵 Egységes zene-illesztés (Phase 4.4): a videó „energiáját" a vágás-ritmusból
 * becsüljük (rövid klipek = pörgős → magas energia), és MINDEN library-track
 * egységes `energy` metaadatához (a workerből, BPM-alapú) hasonlítjuk. Egy
 * pontozó-függvény, uniform módon alkalmazva — nincs per-track heurisztika.
 */

/** A projekt cél-energiája (0–1) az átlagos videó-klip hosszból. */
export function projectMusicTarget(project: Project): number {
  const clips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  if (clips.length === 0) {
    return 0.5;
  }
  const avg = clips.reduce((s, c) => s + c.duration, 0) / clips.length;
  // ugyanaz a görbe, mint a Pacing-sávnál (konzisztencia)
  return clamp(1 - (avg - 1.5) / (8 - 1.5), 0.15, 1);
}

/** Egy track illeszkedése a cél-energiához: 0–1 (1 = tökéletes). */
export function trackMatchScore(track: LibraryTrack, target: number): number {
  const e = typeof track.energy === 'number' ? track.energy : 0.5;
  return Math.round((1 - Math.abs(e - target)) * 100) / 100;
}

/** A könyvtár egységes rangsora a projekt energiájához (a legjobb elöl). */
export function rankLibrary(tracks: LibraryTrack[], project: Project): LibraryTrack[] {
  const target = projectMusicTarget(project);
  return [...tracks].sort((a, b) => trackMatchScore(b, target) - trackMatchScore(a, target));
}
