import { MIN_CLIP_DURATION } from '@/constants/editor';
import type { EditorCommand } from '@/lib/commands';
import { KEYFRAME_CHANNELS } from '@/lib/keyframes';
import { cropClip } from '@/lib/projectUtils';
import type { AudioClip, Clip, ClipKeyframes, Keyframe, Project, TrackType } from '@/types/project';

/**
 * ⏸️➕ Csend beszúrása és ✂️↩️ összeillesztés — tiszta mag (egy köteg = egy undo).
 *
 * - Csend beszúrása `at`-nál `len` mp: a sáv(ok) `at` utáni klipjei `len`-nel később, az `at`-on
 *   átnyúló klip kettéválik (a jobb fele a forrás folytatásával, új azonosítóval). „Minden sáv” módban
 *   a jelölők és a régiók is tolódnak (a beszúrás a teljes projekt idejét tolja). Zárolt sáv kimarad.
 * - Összeillesztés: két szomszédos darab EGY klippé, ha ugyanannak a forrásnak folytatásai (a második
 *   ott kezdődik, ahol az első véget ér — a sávon és a forrásban is) és minden más beállításuk egyezik;
 *   a kettévágás pontos fordítottja (a hang bitre a vágatlané).
 */

export type GapScope = 'track' | 'all';

const EPS = 1e-6;

function shiftClipsFrom(clips: Clip[], at: number, len: number, makeId: (p: string) => string): { clips: Clip[]; changed: boolean } {
  let changed = false;
  const out: Clip[] = [];
  for (const c of clips) {
    const s = c.start;
    const e = c.start + c.duration;
    if (e <= at + EPS) {
      out.push(c);
    } else if (s >= at - EPS) {
      out.push({ ...c, start: s + len });
      changed = true;
    } else {
      // az `at`-on átnyúló klip: bal fele marad, a jobb fele `len`-nel később folytatódik
      changed = true;
      if (at - s >= MIN_CLIP_DURATION && e - at >= MIN_CLIP_DURATION) {
        out.push(cropClip(c, s, at));
        const right = cropClip(c, at, e);
        out.push({ ...right, id: makeId('clip'), start: at + len } as Clip);
      } else if (at - s < MIN_CLIP_DURATION) {
        out.push({ ...c, start: s + len });
      } else {
        out.push(c);
      }
    }
  }
  return { clips: out.sort((a, b) => a.start - b.start), changed };
}

export function insertSilenceCommands(
  project: Project,
  at: number,
  len: number,
  scope: GapScope,
  trackType: TrackType,
  lockedTracks: TrackType[],
  makeId: (p: string) => string
): EditorCommand[] {
  if (!(len > 0) || !(at >= 0)) return [];
  const cmds: EditorCommand[] = [];
  for (const track of project.tracks) {
    if (scope === 'track' && track.type !== trackType) continue;
    if (lockedTracks.includes(track.type)) continue;
    const r = shiftClipsFrom(track.clips, at, len, makeId);
    if (r.changed) cmds.push({ type: 'REPLACE_TRACK_CLIPS', trackType: track.type, clips: r.clips });
  }
  if (scope === 'all') {
    const markers = project.markers ?? [];
    if (markers.some((m) => m.time >= at - EPS)) {
      cmds.push({ type: 'SET_MARKERS', markers: markers.map((m) => (m.time >= at - EPS ? { ...m, time: m.time + len } : m)) });
    }
    const regions = project.regions ?? [];
    if (regions.some((g) => g.end > at + EPS)) {
      cmds.push({
        type: 'SET_REGIONS',
        regions: regions.map((g) => (g.start >= at - EPS ? { ...g, start: g.start + len, end: g.end + len } : g.end > at + EPS ? { ...g, end: g.end + len } : g)),
      });
    }
  }
  return cmds;
}

/** a beállítások (az idő/vágás/fade/automáció nélkül) — az összeillesztés csak azonos beállítású darabokat fűz */
function settingsKey(c: AudioClip): string {
  const rest: Record<string, unknown> = { ...c };
  for (const k of ['id', 'start', 'duration', 'trimIn', 'fadeIn', 'fadeOut', 'keyframes', 'takes', 'activeTake']) delete rest[k];
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function joinKeyframes(a: ClipKeyframes | undefined, aDur: number, b: ClipKeyframes | undefined): ClipKeyframes | undefined {
  if (!a && !b) return undefined;
  const out: ClipKeyframes = {};
  let any = false;
  for (const ch of KEYFRAME_CHANNELS) {
    const ka: Keyframe[] = a?.[ch] ?? [];
    const kb: Keyframe[] = (b?.[ch] ?? []).map((k) => ({ ...k, time: k.time + aDur }));
    // a vágáskor keletkezett határ-kulcskocka (ugyanott, ugyanazzal az értékkel) egyszer marad
    const merged = [...ka.filter((k) => k.time < aDur - EPS || !kb.some((x) => Math.abs(x.time - k.time) < EPS && Math.abs(x.value - k.value) < 1e-9)), ...kb];
    if (merged.length > 0) {
      (out as Record<string, Keyframe[]>)[ch] = merged;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** a klip utáni, vele összeilleszthető szomszéd (ugyanazon a sávon), ha van */
export function joinableNext(project: Project, clipId: string): { a: AudioClip; b: AudioClip } | null {
  for (const track of project.tracks) {
    const a = track.clips.find((c) => c.id === clipId);
    if (!a || a.kind !== 'audio') continue;
    const end = a.start + a.duration;
    const b = track.clips.find(
      (c): c is AudioClip =>
        c.kind === 'audio' &&
        c.id !== a.id &&
        Math.abs(c.start - end) < EPS &&
        c.uri === a.uri &&
        !a.reversed &&
        !a.loopLength &&
        Math.abs((c.trimIn ?? 0) - ((a.trimIn ?? 0) + a.duration * (a.speed ?? 1))) < EPS &&
        settingsKey(c) === settingsKey(a)
    );
    return b ? { a, b } : null;
  }
  return null;
}

/** az összeillesztés parancsai (egy undo); nem illeszthető → [] */
export function joinCommands(project: Project, clipId: string): EditorCommand[] {
  const pair = joinableNext(project, clipId);
  if (!pair) return [];
  const { a, b } = pair;
  const joined: AudioClip = { ...a, duration: a.duration + b.duration, fadeOut: b.fadeOut, keyframes: joinKeyframes(a.keyframes, a.duration, b.keyframes) };
  if (!joined.keyframes) delete joined.keyframes;
  return [
    { type: 'REMOVE_CLIP', clipId: b.id },
    { type: 'UPDATE_CLIP', clipId: a.id, patch: { duration: joined.duration, fadeOut: joined.fadeOut, keyframes: joined.keyframes } },
  ];
}
