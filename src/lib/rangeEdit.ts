import { MIN_CLIP_DURATION } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { cropClip } from '@/lib/projectUtils';
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
      const leftEnd = Math.min(e, inT);
      const keepLeft = leftEnd - s >= MIN_CLIP_DURATION;
      if (keepLeft) {
        // a bal szegmens: ⏪ reversed videónál a trimIn is változik (cropClip kezeli)
        const left = cropClip(c, s, leftEnd);
        out.push({ ...left, duration: round(left.duration) } as Clip);
      }
      const rStart = Math.max(s, outT);
      const rDur = e - rStart;
      if (rDur >= MIN_CLIP_DURATION) {
        // a jobb szegmens forrás-be-pontja (videó ÉS hang) + kulcskockái a kivágott rész
        // UTÁNI tartalomra ugranak (B3 — korábban csak a videó trimIn-je követte)
        const seg = cropClip(c, rStart, e);
        const moved = { ...seg, start: round(rStart - span), duration: round(rDur) } as Clip;
        if ('trimIn' in moved && typeof moved.trimIn === 'number') {
          moved.trimIn = round(moved.trimIn);
        }
        // ha a bal is megmarad (vagy videó-forrás ugrott), a jobbnak új id kell
        if (keepLeft || c.kind === 'video') {
          moved.id = makeId('clip');
        }
        out.push(moved);
      }
    }
    if (changed) {
      patches.push({ trackType: track.type, clips: out });
    }
  }
  return patches.length > 0 ? patches : null;
}

/**
 * ✂️ TÖBB tartomány ripple-törlése egy lépésben (AI csend-vágás, szöveg-alapú vágás —
 * PRO-VIDEO B16). Hátulról előre halad (a korábbi tartományok helye így nem mozdul),
 * minden NEM zárolt sávon ugyanúgy vág és csúsztat, mint a `buildDeleteRangePlan`.
 * A `continuousTracks` (alap: zene) klipjei NEM vágódnak — csak a kezdetük tolódik a
 * kezdetük ELŐTT kivágott idővel (a háttérzene folyamatos marad, nem dadog).
 */
export function buildMultiRangeDeletePlan(
  project: Project,
  ranges: { start: number; end: number }[],
  lockedTracks: TrackType[] = [],
  continuousTracks: TrackType[] = ['music']
): TrackPatch[] | null {
  const sorted = [...ranges].filter((r) => r.end - r.start >= MIN_RANGE).sort((a, b) => b.start - a.start);
  if (sorted.length === 0) {
    return null;
  }
  const skip = [...lockedTracks, ...continuousTracks];
  let cur = project;
  const touched = new Set<TrackType>();
  for (const r of sorted) {
    const plan = buildDeleteRangePlan(cur, r.start, r.end, skip);
    if (!plan) continue;
    const byType = new Map(plan.map((p) => [p.trackType, p.clips]));
    plan.forEach((p) => touched.add(p.trackType));
    cur = { ...cur, tracks: cur.tracks.map((t) => (byType.has(t.type) ? { ...t, clips: byType.get(t.type)! } : t)) };
  }
  // folyamatos sávok: csak eltolás a klip előtti kivágott idővel
  for (const track of project.tracks) {
    if (!continuousTracks.includes(track.type) || lockedTracks.includes(track.type)) continue;
    let changed = false;
    const clips = track.clips.map((c) => {
      const before = sorted.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, c.start) - r.start), 0);
      if (before <= EPS) return c;
      changed = true;
      return { ...c, start: round(Math.max(0, c.start - before)) } as Clip;
    });
    if (changed) {
      touched.add(track.type);
      cur = { ...cur, tracks: cur.tracks.map((t) => (t.type === track.type ? { ...t, clips } : t)) };
    }
  }
  const patches = cur.tracks.filter((t) => touched.has(t.type)).map((t) => ({ trackType: t.type, clips: t.clips }));
  return patches.length > 0 ? patches : null;
}
