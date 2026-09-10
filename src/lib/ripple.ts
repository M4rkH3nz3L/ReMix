import type { Clip, Project, TrackType } from '@/types/project';

/**
 * ⏭️ Ripple szerkesztés — pure réteg.
 *
 * Ripple módban a törlés/hossz-változás nem hagy lyukat: a MÖGÖTTE lévő
 * minden klip elcsúszik. A kérdés csak az, hogy MELY sávokon.
 *
 * Döntés: a ripple az ÖSSZES sávra hat (nem csak a szerkesztettre). Egy
 * TikTok-vágásban a felirat, a zene és az SFX a képhez van igazítva — ha csak a
 * videósáv csúszna, minden szinkron elromlana. Ez eltér a klasszikus NLE-k
 * per-sáv ripple-jétől, de itt ez a helyes viselkedés.
 *
 * A zárolt sávok kimaradnak: a zárolás pont azt jelenti, hogy „ehhez ne nyúlj".
 */

/** ennél kisebb eltolást nem érdemes végigvinni (lebegőpontos zaj) */
const EPS = 0.001;

export interface RipplePlan {
  tracks: { trackType: TrackType; clips: Clip[] }[];
  /** hány klip mozdult el */
  moved: number;
  /** az eltolás nagysága (negatív = balra záródik a lyuk) */
  shift: number;
}

/**
 * A `from` időpont UTÁN kezdődő klipek eltolása `shift` mp-cel, minden
 * (nem zárolt) sávon. A `from`-nál korábban kezdődő klipek nem mozdulnak, még
 * ha átnyúlnak is a ponton — azok a szerkesztett elem „alatt" élnek.
 */
export function buildRipplePlan(
  project: Project,
  from: number,
  shift: number,
  opts: { lockedTracks?: TrackType[]; skipClipIds?: string[] } = {}
): RipplePlan | null {
  if (Math.abs(shift) < EPS) {
    return null;
  }
  const locked = new Set(opts.lockedTracks ?? []);
  const skip = new Set(opts.skipClipIds ?? []);
  let moved = 0;
  const tracks: { trackType: TrackType; clips: Clip[] }[] = [];

  for (const track of project.tracks) {
    if (locked.has(track.type)) {
      continue;
    }
    let touched = false;
    const clips = track.clips.map((c) => {
      if (skip.has(c.id) || c.start < from - EPS) {
        return c;
      }
      touched = true;
      moved += 1;
      // a 0 alá csúszást nem engedjük — a projekt eleje fix pont
      return { ...c, start: Math.max(0, Math.round((c.start + shift) * 1000) / 1000) };
    });
    if (touched) {
      tracks.push({ trackType: track.type, clips });
    }
  }
  return tracks.length > 0 ? { tracks, moved, shift } : null;
}

/**
 * Ripple TÖRLÉS: a klip eltűnik, és a mögötte lévő minden a helyére csúszik.
 * A törölt klip sávja is benne van a tervben (onnan kikerül a klip).
 */
export function buildRippleDeletePlan(
  project: Project,
  clipIds: string[],
  opts: { lockedTracks?: TrackType[] } = {}
): RipplePlan | null {
  const ids = new Set(clipIds);
  const removed = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => ids.has(c.id));
  if (removed.length === 0) {
    return null;
  }
  // a kijelölés által lefedett szakasz zárul be
  const from = Math.min(...removed.map((c) => c.start));
  const to = Math.max(...removed.map((c) => c.start + c.duration));
  const shift = -(to - from);

  const locked = new Set(opts.lockedTracks ?? []);
  let moved = 0;
  const tracks: { trackType: TrackType; clips: Clip[] }[] = [];
  for (const track of project.tracks) {
    if (locked.has(track.type)) {
      continue;
    }
    const hasRemoved = track.clips.some((c) => ids.has(c.id));
    let touched = hasRemoved;
    const clips = track.clips
      .filter((c) => !ids.has(c.id))
      .map((c) => {
        // csak a záruló szakasz UTÁN kezdődők csúsznak
        if (c.start < to - EPS) {
          return c;
        }
        touched = true;
        moved += 1;
        return { ...c, start: Math.max(0, Math.round((c.start + shift) * 1000) / 1000) };
      });
    if (touched) {
      tracks.push({ trackType: track.type, clips });
    }
  }
  return tracks.length > 0 ? { tracks, moved, shift } : null;
}

/**
 * Ripple HOSSZ-VÁLTOZÁS: a klip új hosszt kap, és a mögötte lévők a
 * különbséggel csúsznak. A klip maga a saját sávján marad a helyén.
 */
export function buildRippleResizePlan(
  project: Project,
  clipId: string,
  nextDuration: number,
  opts: { lockedTracks?: TrackType[] } = {}
): RipplePlan | null {
  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) {
    return null;
  }
  const shift = nextDuration - clip.duration;
  if (Math.abs(shift) < EPS) {
    return null;
  }
  const plan = buildRipplePlan(project, clip.start + clip.duration - EPS, shift, {
    ...opts,
    skipClipIds: [clipId],
  });
  const tracks = plan?.tracks ?? [];
  // a szerkesztett klip új hossza is a tervbe kerül (egy undo-lépés legyen)
  const ownerType = project.tracks.find((t) => t.clips.some((c) => c.id === clipId))!.type;
  const existing = tracks.find((t) => t.trackType === ownerType);
  const base = existing?.clips ?? project.tracks.find((t) => t.type === ownerType)!.clips;
  const withResize = base.map((c) =>
    c.id === clipId ? ({ ...c, duration: nextDuration } as Clip) : c
  );
  if (existing) {
    existing.clips = withResize;
  } else {
    tracks.push({ trackType: ownerType, clips: withResize });
  }
  return { tracks, moved: plan?.moved ?? 0, shift };
}
