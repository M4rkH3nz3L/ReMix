import { makeId } from '@/lib/id';
import { splitClip } from '@/lib/projectUtils';
import type { AudioClip, Clip, Project } from '@/types/project';

/**
 * Pure vágásterv-építő (expo-mentes, tesztelhető) — a csend-detektálás
 * hálózati része a cutlist.ts-ben van.
 */

export interface SilenceRange {
  /** forrás-idő (mp) */
  start: number;
  end: number;
}

/** a csend két szélén ennyi levegő marad (nem vágunk szó-határra) */
const EDGE_PAD = 0.15;
/** ennél rövidebb megmaradó szakasz elhagyva (villanás lenne) */
const MIN_KEEP = 0.25;
/** jelenetvágásnál ennél rövidebb darab nem jön létre (idővonal-mp) */
const MIN_SCENE_SEG = 0.3;

export interface SceneSplitPlan {
  /** az új videósáv-kliplista — az elrendezés változatlan, csak a vágások újak */
  clips: Clip[];
  /** beszúrt vágások száma */
  splits: number;
}

/**
 * Jelenetvágás-terv: a videóklipek felvágása a forrás-idejű jelenetváltásoknál.
 * Nem ripple — minden darab ott marad, ahol az eredeti klip volt, csak a
 * határok kerülnek be. Pure függvény.
 */
export function buildSceneSplitPlan(
  project: Project,
  scenesByUri: Map<string, number[]>
): SceneSplitPlan | null {
  const track = project.tracks.find((t) => t.type === 'video');
  if (!track || track.clips.length === 0) {
    return null;
  }
  const out: Clip[] = [];
  let splits = 0;

  for (const clip of track.clips) {
    if (clip.kind !== 'video') {
      out.push(clip);
      continue;
    }
    const scenes = scenesByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;
    // csak a klip belsejébe eső váltások, minimum-darabhossz betartásával
    const cuts = scenes
      .filter(
        (t) =>
          t > winStart + MIN_SCENE_SEG * clip.speed &&
          t < winEnd - MIN_SCENE_SEG * clip.speed
      )
      .sort((a, b) => a - b)
      // két váltás közt is legyen minimum-darab
      .filter((t, i, arr) => i === 0 || t - arr[i - 1] >= MIN_SCENE_SEG * clip.speed);

    if (cuts.length === 0) {
      out.push(clip);
      continue;
    }

    let srcPos = winStart;
    for (const cut of [...cuts, winEnd]) {
      const duration = (cut - srcPos) / clip.speed;
      out.push({
        ...clip,
        id: srcPos === winStart ? clip.id : makeId('clip'),
        trimIn: srcPos,
        duration,
        start: clip.start + (srcPos - winStart) / clip.speed,
      });
      srcPos = cut;
    }
    splits += cuts.length;
  }

  if (splits === 0) {
    return null;
  }
  return { clips: out, splits };
}

/** beat-vágásnál ennél rövidebb darab nem jön létre (idővonal-mp) */
const MIN_BEAT_SEG = 0.35;

export interface BeatSplitPlan {
  clips: Clip[];
  splits: number;
}

/** Zeneklip forrás-idejű beat-listája idővonal-időben, a klip ablakára szűkítve. */
export function timelineBeats(clip: AudioClip, beats: number[]): number[] {
  return beats
    .map((t) => clip.start + t)
    .filter((t) => t > clip.start && t < clip.start + clip.duration);
}

/**
 * Beat-vágás terv (P0‑2): a videósáv klipjeinek felvágása a megadott
 * idővonal-időpontokon. Nem ripple — semmi nem mozdul, csak határok kerülnek
 * be; a kulcskockákat a splitClip szétosztja. Pure függvény.
 */
export function buildBeatSplitPlan(
  project: Project,
  times: number[]
): BeatSplitPlan | null {
  const track = project.tracks.find((t) => t.type === 'video');
  if (!track || track.clips.length === 0) {
    return null;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const out: Clip[] = [];
  let splits = 0;

  for (const clip of track.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      out.push(clip);
      continue;
    }
    let current: Clip = clip;
    let lastCut = clip.start;
    const clipEndT = clip.start + clip.duration;
    for (const t of sorted) {
      if (t < lastCut + MIN_BEAT_SEG) {
        continue;
      }
      if (t > clipEndT - MIN_BEAT_SEG) {
        break;
      }
      const parts = splitClip(current, t);
      if (!parts) {
        continue;
      }
      out.push(parts[0]);
      current = parts[1];
      lastCut = t;
      splits += 1;
    }
    out.push(current);
  }

  if (splits === 0) {
    return null;
  }
  return { clips: out, splits };
}

export interface CutPlan {
  /** az új videósáv-kliplista, hézag nélkül */
  clips: Clip[];
  /** alkalmazott vágások száma */
  cuts: number;
  /** ennyi idő esik ki az idővonalból (mp) */
  removedSeconds: number;
}

/**
 * Vágásterv a videósávra a fájlonkénti csend-listákból. Pure függvény:
 * nem ír state-et, csak az új kliplistát adja vissza. A nem-videó klipek
 * (képek) érintetlenül, sorrendben kerülnek vissza.
 */
export function buildCutPlan(
  project: Project,
  silencesByUri: Map<string, SilenceRange[]>
): CutPlan | null {
  return buildRangeCutPlan(project, silencesByUri, EDGE_PAD);
}

/**
 * Általános ripple-vágásterv: a megadott FORRÁS-idejű tartományok kivágása a
 * videósávból (pl. kijelölt szavak — text-based editing, P0‑3). A pad a
 * tartomány széleit zsugorítja (csendnél levegőt hagy; szavaknál 0).
 */
export function buildRangeCutPlan(
  project: Project,
  rangesByUri: Map<string, SilenceRange[]>,
  pad = 0
): CutPlan | null {
  const track = project.tracks.find((t) => t.type === 'video');
  if (!track || track.clips.length === 0) {
    return null;
  }
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  let cursor = ordered[0].start;
  let cuts = 0;
  let removed = 0;

  for (const clip of ordered) {
    if (clip.kind !== 'video') {
      out.push({ ...clip, start: cursor });
      cursor += clip.duration;
      continue;
    }
    const silences = rangesByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;

    // pad-elt tartományok metszete a klip forrás-ablakával
    const cutRanges: SilenceRange[] = [];
    for (const s of silences) {
      const from = Math.max(winStart, s.start + pad);
      const to = Math.min(winEnd, s.end - pad);
      if (to - from > 0.05) {
        cutRanges.push({ start: from, end: to });
      }
    }
    cutRanges.sort((a, b) => a.start - b.start);

    // megmaradó forrás-szakaszok
    const kept: SilenceRange[] = [];
    let pos = winStart;
    for (const range of cutRanges) {
      if (range.start - pos >= MIN_KEEP * clip.speed) {
        kept.push({ start: pos, end: range.start });
      }
      pos = Math.max(pos, range.end);
    }
    if (winEnd - pos >= MIN_KEEP * clip.speed) {
      kept.push({ start: pos, end: winEnd });
    }

    if (kept.length === 0) {
      // a teljes klip csend — kimarad
      cuts += 1;
      removed += clip.duration;
      continue;
    }

    const keptDuration = kept.reduce((sum, k) => sum + (k.end - k.start) / clip.speed, 0);
    if (kept.length === 1 && clip.duration - keptDuration < 0.05) {
      // nincs érdemi vágnivaló ebben a klipben
      out.push({ ...clip, start: cursor });
      cursor += clip.duration;
      continue;
    }

    cuts += cutRanges.length;
    removed += clip.duration - keptDuration;
    for (const k of kept) {
      const duration = (k.end - k.start) / clip.speed;
      out.push({
        ...clip,
        id: makeId('clip'),
        trimIn: k.start,
        duration,
        start: cursor,
      });
      cursor += duration;
    }
  }

  if (removed < 0.05) {
    return null;
  }
  return { clips: out, cuts, removedSeconds: removed };
}
