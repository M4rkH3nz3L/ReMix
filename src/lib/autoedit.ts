import { makeId } from '@/lib/id';
import type { TranscriptLine } from '@/lib/transcripts';
import type { Clip, ImageClip, Project, TextClip, VideoClip } from '@/types/project';

/**
 * AI Edit Engine (P0‑1) — pure mag. Az AI (vagy a heurisztika) VÁLTOZATOKAT ad:
 * megtartandó idővonal-sávok sorrendben (a sorrend = a story!) + felirat-
 * javaslatok. Ebből ez a modul determinisztikusan fordít EditorCommand-okat —
 * az AI sosem ír state-et, a whitelist/undo elv változatlan.
 */

export interface TimeRange {
  start: number;
  end: number;
}

/** A projekt elemzett jelei idővonal-időben — a kontextus alapja. */
export interface AutoEditSignals {
  /** a teljes idővonal hossza (mp) */
  duration: number;
  /** cél-hossz (mp) */
  targetSeconds: number;
  /** jelenetváltás-pontok */
  scenes: number[];
  /** beszéd-sorok */
  transcript: TranscriptLine[];
  /** csend-sávok */
  silences: TimeRange[];
  /** beat-rács (üres, ha nincs zene) */
  beats: number[];
  bpm: number;
  /** 🏆 best-shot: vizuális minőség idővonal-pontokon (élesség+kontraszt+arc) */
  shotScores?: { t: number; score: number; faces: number }[];
}

export type VariantId = 'viral' | 'cinematic' | 'fast';

export interface AutoEditCaption {
  text: string;
  /** az EREDETI idővonalon értett kezdet (mp) — a compile remapeli */
  start: number;
  duration: number;
}

export interface AutoEditVariant {
  id: VariantId;
  title: string;
  /** rövid magyar indoklás a kártyára */
  rationale: string;
  /** megtartandó sávok az EREDETI idővonalon — a sorrend a vágás sorrendje */
  keep: TimeRange[];
  captions: AutoEditCaption[];
}

/** forrás-idejű pontok (pl. jelenetváltás) → idővonal-idő a klipablakokon át */
export function mapSourcePointsToTimeline(
  clips: VideoClip[],
  pointsByUri: Map<string, number[]>
): number[] {
  const out: number[] = [];
  for (const clip of clips) {
    const points = pointsByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;
    for (const p of points) {
      if (p > winStart && p < winEnd) {
        out.push(clip.start + (p - winStart) / clip.speed);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** forrás-idejű sávok (pl. csend) → idővonal-sávok a klipablakokon át */
export function mapSourceRangesToTimeline(
  clips: VideoClip[],
  rangesByUri: Map<string, TimeRange[]>
): TimeRange[] {
  const out: TimeRange[] = [];
  for (const clip of clips) {
    const ranges = rangesByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;
    for (const r of ranges) {
      const from = Math.max(r.start, winStart);
      const to = Math.min(r.end, winEnd);
      if (to - from > 0.05) {
        out.push({
          start: clip.start + (from - winStart) / clip.speed,
          end: clip.start + (to - winStart) / clip.speed,
        });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** tisztítás: klippelés a [0,duration]-ra, minimum-hossz, rendezés NÉLKÜL (sorrend = story) */
export function sanitizeKeeps(keeps: TimeRange[], duration: number): TimeRange[] {
  return keeps
    .map((k) => ({
      start: Math.max(0, Math.min(k.start, duration)),
      end: Math.max(0, Math.min(k.end, duration)),
    }))
    .filter((k) => k.end - k.start >= 0.2);
}

/**
 * Az EREDETI idővonal t pontja hol van az összefűzött keep-sávokon? (felirat-
 * remaphez; kivágott pontnál a következő megtartott szakasz elejére csúszik)
 */
export function remapTime(keeps: TimeRange[], t: number): number {
  let cursor = 0;
  for (const k of keeps) {
    if (t < k.start) {
      return cursor;
    }
    if (t <= k.end) {
      return cursor + (t - k.start);
    }
    cursor += k.end - k.start;
  }
  return cursor;
}

/**
 * Új videósáv-kliplista a rendezett keep-sávokból: minden sáv a fedő klipek
 * trim/sebesség-helyes darabjait adja, hézag nélkül egymás után (a keep-sorrend
 * szerint — átrendezés is lehetséges). A szél-fade/kulcskocka a darabokról
 * lekerül (időzítésük a vágás után félrevinne).
 */
export function buildKeepPlan(project: Project, keeps: TimeRange[]): Clip[] {
  const track = project.tracks.find((t) => t.type === 'video');
  const clips = (track?.clips ?? [])
    .filter((c): c is VideoClip | ImageClip => c.kind === 'video' || c.kind === 'image')
    .sort((a, b) => a.start - b.start);

  const out: Clip[] = [];
  let cursor = 0;
  for (const keep of keeps) {
    for (const clip of clips) {
      const clipEnd = clip.start + clip.duration;
      const from = Math.max(keep.start, clip.start);
      const to = Math.min(keep.end, clipEnd);
      if (to - from < 0.1) {
        continue;
      }
      const duration = to - from;
      const piece: VideoClip | ImageClip = {
        ...clip,
        id: makeId('clip'),
        start: cursor,
        duration,
        fadeInSec: undefined,
        fadeOutSec: undefined,
        keyframes: undefined,
      };
      if (piece.kind === 'video' && clip.kind === 'video') {
        piece.trimIn = clip.trimIn + (from - clip.start) * clip.speed;
      }
      out.push(piece);
      cursor += duration;
    }
  }
  return out;
}

/** felirat-alapértelmezések — az aiCommands caption-defaultjaival egyező ízlés */
function captionClip(c: AutoEditCaption, start: number): TextClip {
  return {
    kind: 'text',
    id: makeId('clip'),
    start,
    duration: Math.max(0.5, c.duration),
    text: c.text,
    color: '#ffffff',
    backgroundColor: null,
    fontSize: 5,
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.78 },
    animation: 'pop',
    stylePreset: 'bubble',
  };
}

export interface CompiledVariant {
  variant: AutoEditVariant;
  videoClips: Clip[];
  captionClips: TextClip[];
  /** az új idővonal hossza (mp) */
  totalSeconds: number;
  cuts: number;
}

/** Változat → determinisztikus vágás-eredmény (a dispatch a hívó dolga). */
export function compileVariant(
  project: Project,
  variant: AutoEditVariant,
  duration: number
): CompiledVariant | null {
  const keeps = sanitizeKeeps(variant.keep, duration);
  if (keeps.length === 0) {
    return null;
  }
  const videoClips = buildKeepPlan(project, keeps);
  if (videoClips.length === 0) {
    return null;
  }
  const totalSeconds = videoClips.reduce((s, c) => s + c.duration, 0);
  const captionClips = variant.captions
    .filter((c) => c.text.trim().length > 0)
    .map((c) => {
      const start = remapTime(keeps, c.start);
      return captionClip(c, Math.min(start, Math.max(0, totalSeconds - 0.5)));
    });
  return {
    variant,
    videoClips,
    captionClips,
    totalSeconds,
    cuts: Math.max(0, videoClips.length - 1),
  };
}

/** a legközelebbi beat-re igazít, ha 0.3 mp-en belül van */
function snapToBeat(t: number, beats: number[]): number {
  let best = t;
  let bestDist = 0.3;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/** beszéd-szegmensek az átiratból (kis rések összeolvasztva, szél-pad) */
export function speechSegments(transcript: TranscriptLine[]): TimeRange[] {
  const segs: TimeRange[] = [];
  for (const line of transcript) {
    const last = segs[segs.length - 1];
    if (last && line.start - last.end <= 0.4) {
      last.end = Math.max(last.end, line.end);
    } else {
      segs.push({ start: Math.max(0, line.start - 0.15), end: line.end + 0.15 });
    }
  }
  return segs;
}

/** szegmens-lista vágása a cél-hosszra (az utolsó darab hátulról rövidül) */
function fitToTarget(segs: TimeRange[], target: number, beats: number[]): TimeRange[] {
  const out: TimeRange[] = [];
  let total = 0;
  for (const seg of segs) {
    const len = seg.end - seg.start;
    if (total + len <= target) {
      out.push({ ...seg });
      total += len;
      continue;
    }
    const remaining = target - total;
    if (remaining >= 0.8) {
      out.push({ start: seg.start, end: snapToBeat(seg.start + remaining, beats) });
    }
    break;
  }
  return out;
}

/**
 * Cél-hossz guard az AI-változatokra: ha a keep-lista jóval a cél fölé lő,
 * determinisztikusan visszavágjuk (a story eleje marad, beat-re igazítva).
 */
export function fitKeepsToTarget(
  keeps: TimeRange[],
  target: number,
  beats: number[] = []
): TimeRange[] {
  return fitToTarget(keeps, target, beats);
}

/**
 * Heurisztikus fallback — AI nélkül is három használható változat:
 * · fast: beszéd-szegmensek sorban a cél-hosszig (a csend kimarad)
 * · viral: hook (első szegmens) + a leghosszabb szegmensek + záró szegmens
 * · cinematic: jelenetenként egy szelet, egyenletesen a cél-hosszra
 */
export function heuristicVariants(signals: AutoEditSignals): AutoEditVariant[] {
  const { duration, targetSeconds, beats } = signals;
  const speech = speechSegments(signals.transcript);
  const base = speech.length > 0 ? speech : [{ start: 0, end: duration }];

  const fast = fitToTarget(base, targetSeconds, beats);

  let viral: TimeRange[];
  if (base.length >= 3) {
    const hook = base[0];
    const closer = base[base.length - 1];
    const middle = base
      .slice(1, -1)
      .slice()
      .sort((a, b) => b.end - b.start - (a.end - a.start));
    const picked = [hook];
    let total = hook.end - hook.start + (closer.end - closer.start);
    for (const seg of middle) {
      const len = seg.end - seg.start;
      if (total + len > targetSeconds) {
        continue;
      }
      picked.push(seg);
      total += len;
    }
    // a közepe idő-sorrendben, a záró a végén
    const middleSorted = picked.slice(1).sort((a, b) => a.start - b.start);
    viral = [hook, ...middleSorted, closer];
  } else {
    viral = fitToTarget(base, targetSeconds, beats);
  }

  let cinematic: TimeRange[];
  const sceneBounds = [0, ...signals.scenes, duration];
  let sceneSpans: TimeRange[] = [];
  for (let i = 0; i < sceneBounds.length - 1; i++) {
    if (sceneBounds[i + 1] - sceneBounds[i] >= 0.8) {
      sceneSpans.push({ start: sceneBounds[i], end: sceneBounds[i + 1] });
    }
  }
  // 🏆 best-shot: ha több a jelenet, mint ami a cél-hosszba fér, a vizuálisan
  // legjobbak maradnak (a pontszám a jelenetbe eső shot-pontok maximuma)
  const shotScoreFor = (span: TimeRange): number => {
    const inSpan = (signals.shotScores ?? []).filter(
      (s) => s.t >= span.start - 0.3 && s.t < span.end + 0.3
    );
    return inSpan.length > 0 ? Math.max(...inSpan.map((s) => s.score)) : 0;
  };
  const maxScenes = Math.max(2, Math.floor(targetSeconds / 1.5));
  if (sceneSpans.length > maxScenes && (signals.shotScores?.length ?? 0) > 0) {
    sceneSpans = [...sceneSpans]
      .sort((a, b) => shotScoreFor(b) - shotScoreFor(a))
      .slice(0, maxScenes)
      .sort((a, b) => a.start - b.start);
  }
  if (sceneSpans.length >= 2) {
    const perScene = Math.max(1, targetSeconds / sceneSpans.length);
    cinematic = sceneSpans.map((s) => ({
      start: s.start,
      end: Math.min(s.end, snapToBeat(s.start + perScene, beats)),
    }));
  } else {
    cinematic = fitToTarget(base, targetSeconds, beats);
  }

  const captionsFor = (keeps: TimeRange[]): AutoEditCaption[] =>
    signals.transcript
      .filter((l) => keeps.some((k) => l.start >= k.start - 0.2 && l.start < k.end))
      .slice(0, 12)
      .map((l) => ({
        text: l.text.length > 42 ? `${l.text.slice(0, 40)}…` : l.text,
        start: l.start,
        duration: Math.max(0.6, l.end - l.start),
      }));

  return [
    {
      id: 'viral',
      title: '🔥 Viral',
      rationale: 'Hook az elejére, a legerősebb részek középre, zárás a végéről.',
      keep: viral,
      captions: captionsFor(viral),
    },
    {
      id: 'cinematic',
      title: '🎬 Cinematic',
      rationale:
        (signals.shotScores?.length ?? 0) > 0
          ? 'A vizuálisan legszebb jelenetekből egy-egy szelet, egyenletes tempóban.'
          : 'Minden jelenetből egy szelet, egyenletes tempóban.',
      keep: cinematic,
      captions: captionsFor(cinematic),
    },
    {
      id: 'fast',
      title: '⚡ Fast-paced',
      rationale: 'Csak a beszéd, csend nélkül, a cél-hosszra vágva.',
      keep: fast,
      captions: captionsFor(fast),
    },
  ];
}

/** kompakt, kerekített kontextus az AI-nak */
export function buildAutoEditContext(signals: AutoEditSignals): object {
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    durationSeconds: r(signals.duration),
    targetSeconds: signals.targetSeconds,
    scenes: signals.scenes.map(r),
    silences: signals.silences.map((s) => ({ start: r(s.start), end: r(s.end) })),
    bpm: signals.bpm || undefined,
    beats: signals.beats.slice(0, 60).map(r),
    transcript: signals.transcript.map((l) => ({
      start: r(l.start),
      end: r(l.end),
      text: l.text,
    })),
    // 🏆 vizuális minőség idővonal-pontokon — magasabb = szebb/élesebb kocka,
    // faces > 0 = arc van a képen
    shotScores: (signals.shotScores ?? []).slice(0, 24).map((s) => ({
      t: r(s.t),
      score: Math.round(s.score),
      faces: s.faces,
    })),
  };
}
