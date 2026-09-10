import type { Clip, Project } from '@/types/project';

/**
 * 🎬 Részlet-előnézet — pure réteg.
 *
 * A legerősebb funkciók (részecskék, mozgás-elmosás, égcsere, 3D matricák,
 * arc-elmosás, upscale, 3D szöveg, átmenetek) CSAK a renderben látszanak — az
 * élő előnézet vagy közelít, vagy semmit nem mutat. Ez azt jelentené, hogy
 * ezeket csak teljes export után látod.
 *
 * A megoldás: a playhead körüli pár másodpercet kivágjuk egy ÖNÁLLÓ, kis
 * projektté, azt rendereltetjük le a workerrel (pár másodperc), és
 * visszajátsszuk. Ugyanaz a render-motor, ugyanaz a végeredmény — csak rövid.
 */

/** a kivágott ablak alapértelmezett hossza (mp) */
export const PREVIEW_WINDOW = 3;
/** ennyivel a playhead ELŐTT kezdődik az ablak (a többi utána) */
export const PREVIEW_LEAD = 1;

/** ennél rövidebb maradék nem éri meg — a klip kimarad */
const MIN_SLICE = 0.06;

/**
 * Egy klip átvágása a [from, to] ablakra, az ablak elejéhez igazított
 * kezdettel. `null`, ha a klip nem lóg bele.
 *
 * A videóklip forrás-pozícióját a SEBESSÉGGEL szorozva kell léptetni: ha 2×-es
 * sebességnél az ablak 1 mp-cel a klip kezdete után indul, a forrásban 2 mp-et
 * kell előrelépni.
 */
export function sliceClip(clip: Clip, from: number, to: number): Clip | null {
  const clipStart = clip.start;
  const clipEnd = clip.start + clip.duration;
  const visStart = Math.max(clipStart, from);
  const visEnd = Math.min(clipEnd, to);
  const duration = visEnd - visStart;
  if (duration < MIN_SLICE) {
    return null;
  }
  const cutFromHead = visStart - clipStart;
  const next = {
    ...clip,
    start: visStart - from,
    duration,
  } as Clip;

  if (next.kind === 'video' && clip.kind === 'video') {
    next.trimIn = clip.trimIn + cutFromHead * clip.speed;
  }
  // a kulcskockák a klip-idejéhez képest vannak — az ablak elejére toljuk és
  // a maradékon kívülieket eldobjuk (a klip eleje/vége levágódott)
  if ('keyframes' in next && next.keyframes) {
    const shifted: Record<string, unknown> = {};
    for (const [channel, points] of Object.entries(next.keyframes)) {
      if (!Array.isArray(points)) {
        continue;
      }
      const moved = points
        .map((p) => ({ ...p, time: p.time - cutFromHead }))
        .filter((p) => p.time >= -0.001 && p.time <= duration + 0.001);
      if (moved.length > 0) {
        shifted[channel] = moved;
      }
    }
    (next as { keyframes?: unknown }).keyframes =
      Object.keys(shifted).length > 0 ? shifted : undefined;
  }
  // az ablak VÉGÉN levágott klip kimenő átmenete értelmetlen (nincs mibe átúszni)
  if ('transitionOut' in next && visEnd < clipEnd - 0.001) {
    (next as { transitionOut?: unknown }).transitionOut = undefined;
  }
  return next;
}

/** a kivágandó ablak a playhead körül, a projekt határaira szorítva */
export function windowAround(
  playhead: number,
  projectDuration: number,
  length = PREVIEW_WINDOW,
  lead = PREVIEW_LEAD
): { from: number; to: number } {
  const span = Math.min(length, Math.max(projectDuration, 0.5));
  let from = playhead - lead;
  if (from < 0) {
    from = 0;
  }
  if (from + span > projectDuration) {
    from = Math.max(0, projectDuration - span);
  }
  return { from, to: from + span };
}

/**
 * A részlet-projekt: minden sáv klipjei az ablakra vágva, az ablak elejéhez
 * igazítva. A projekt-szintű beállítások (arány, részecskék) átjönnek, hogy a
 * render pontosan azt adja, amit a teljes exportban látnál.
 *
 * `null`, ha az ablakban nincs semmi renderelni való.
 */
export function buildPreviewWindow(
  project: Project,
  from: number,
  to: number
): Project | null {
  let clipCount = 0;
  const tracks = project.tracks.map((track) => {
    const clips = track.clips
      .map((c) => sliceClip(c, from, to))
      .filter((c): c is Clip => c !== null)
      .sort((a, b) => a.start - b.start);
    clipCount += clips.length;
    return { ...track, clips };
  });
  if (clipCount === 0) {
    return null;
  }
  return {
    ...project,
    id: `${project.id}_preview`,
    name: 'reszlet-elonezet',
    tracks,
  };
}
