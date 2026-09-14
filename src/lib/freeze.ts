import { splitClip } from '@/lib/projectUtils';
import type { Clip, ImageClip, Project, TrackType } from '@/types/project';

/**
 * ❄️ Freeze / hold frame: a `time`-nál kettévágja a cél-videóklipet, a helyére
 * egy állókocka-képet (`still`) tesz `duration` hosszan, és MINDEN sávon a
 * `time`-tól kezdődő klipeket +`duration`-nel eltolja (ripple). A `time`-ot
 * ÁTÍVELŐ hangklip (start < time) NEM tolódik → a kép áll, de a hang tovább szól
 * (short-form freeze). A `REPLACE_TRACKS` parancshoz ad kész sáv-terveket.
 *
 * Pure, tesztelhető. `null`, ha a vágás nem lehetséges (a playhead nem a klipen
 * belül van, vagy a darabok túl rövidek).
 */
export function buildFreezePlan(
  project: Project,
  clipId: string,
  time: number,
  duration: number,
  still: ImageClip
): { tracks: { trackType: TrackType; clips: Clip[] }[] } | null {
  const videoTrack = project.tracks.find((t) => t.type === 'video');
  const target = videoTrack?.clips.find((c) => c.id === clipId);
  if (!videoTrack || !target || target.kind !== 'video') {
    return null;
  }
  const parts = splitClip(target, time);
  if (!parts) {
    return null;
  }
  const [before, after] = parts;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const stillClip: ImageClip = { ...still, start: round(time), duration };
  const EPS = 1e-4;

  const tracks: { trackType: TrackType; clips: Clip[] }[] = [];
  for (const track of project.tracks) {
    let changed = false;
    let clips: Clip[];
    if (track.type === 'video') {
      clips = track.clips.flatMap((c) => {
        if (c.id === clipId) {
          changed = true;
          return [before, stillClip, { ...after, start: round(after.start + duration) }];
        }
        if (c.start >= time - EPS) {
          changed = true;
          return [{ ...c, start: round(c.start + duration) }];
        }
        return [c];
      });
    } else {
      clips = track.clips.map((c) => {
        if (c.start >= time - EPS) {
          changed = true;
          return { ...c, start: round(c.start + duration) };
        }
        return c;
      });
    }
    if (changed) {
      tracks.push({ trackType: track.type, clips: [...clips].sort((a, b) => a.start - b.start) });
    }
  }
  return tracks.length ? { tracks } : null;
}
