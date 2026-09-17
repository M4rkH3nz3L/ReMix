import { MIN_CLIP_DURATION } from '@/constants/editor';
import { makeId } from '@/lib/id';
import type { Clip, Project, TrackType } from '@/types/project';

/**
 * 🗑️ Range-törlés (in/out közötti sáv kivágása) TISZTA magja.
 *
 * Minden NEM zárolt sávon kiveszi az `[in, out]` metszetet, és a mögötte lévő
 * tartalmat balra csúsztatja — ez a „ripple delete over range", az egyik
 * legnagyobb adatvesztési kockázatú művelet a vágóban, ezért külön tesztelhető.
 *
 * Csak az ÉRINTETT sávokat adja vissza (`REPLACE_TRACKS` patch-formában); ha
 * semmi nem változna, `null`. A dispatch és a UI-állapot (playhead, kijelölés)
 * a hívó dolga.
 */

const round = (n: number) => Math.round(n * 1000) / 1000;

/** ennél rövidebb range-et nem érdemes törölni */
export const MIN_RANGE = 0.05;
/** lebegőpontos tűrés a határok összehasonlításánál */
const EPS = 0.001;

export type TrackPatch = { trackType: TrackType; clips: Clip[] };

export function buildDeleteRangePlan(
  project: Project,
  inT: number,
  outT: number,
  lockedTracks: TrackType[] = []
): TrackPatch[] | null {
  const span = outT - inT;
  if (!(span >= MIN_RANGE)) {
    return null;
  }

  const patches: TrackPatch[] = [];
  for (const track of project.tracks) {
    if (lockedTracks.includes(track.type)) {
      continue;
    }
    let changed = false;
    const out: Clip[] = [];
    for (const c of track.clips) {
      const s = c.start;
      const e = c.start + c.duration;
      if (e <= inT + EPS) {
        out.push(c); // teljesen a range előtt — marad
        continue;
      }
      if (s >= outT - EPS) {
        out.push({ ...c, start: round(s - span) }); // teljesen utána — balra csúszik
        changed = true;
        continue;
      }
      // a range-be lóg: a metszet kiesik, a bal/jobb szegmens marad
      changed = true;
      const leftDur = Math.min(e, inT) - s;
      const keepLeft = leftDur >= MIN_CLIP_DURATION;
      if (keepLeft) {
        out.push({ ...c, duration: round(leftDur) });
      }
      const rStart = Math.max(s, outT);
      const rDur = e - rStart;
      if (rDur >= MIN_CLIP_DURATION) {
        const seg = { ...c, start: round(rStart - span), duration: round(rDur) } as Clip;
        // a jobb szegmens forrás-be-pontja a kivágott rész UTÁNI tartalomra ugrik
        if (seg.kind === 'video' && c.kind === 'video') {
          seg.id = makeId('clip');
          seg.trimIn = round(c.trimIn + (rStart - s) * c.speed);
        } else if (keepLeft) {
          seg.id = makeId('clip'); // ha a bal is megmarad, a jobbnak új id kell
        }
        out.push(seg);
      }
    }
    if (changed) {
      patches.push({ trackType: track.type, clips: out });
    }
  }
  return patches.length > 0 ? patches : null;
}
