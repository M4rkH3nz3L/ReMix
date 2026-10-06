import { clipEnd, projectDuration } from '@/lib/projectUtils';
import type { Clip, Project } from '@/types/project';

/**
 * 🧠 AI Context Builder (audit §5.1) — tiszta, expo-mentes mag.
 *
 * NEM a teljes project-JSON-t adjuk minden AI-kéréshez (token-pazarlás + zaj),
 * hanem HÁROM réteget: **Global** (projekt-meta), **Current** (a kijelölt klip),
 * **Relevant** (a lejátszófej körüli klipek). A nehéz adatokat (nyers keyframe-ek,
 * base64, teljes klip-tömbök) KIHAGYJUK. Így az AI pontos, kicsi kontextust kap.
 * Tiszta függvény → tesztelhető; a bekötés (aiCommands/chatCommands a teljes JSON
 * helyett ezt küldi) a következő lépés.
 */

export interface AiContextFocus {
  selectedClipId?: string;
  /** a lejátszófej (mp) — ekörül válogatjuk a „relevant" klipeket */
  playhead?: number;
  /** a relevant-ablak fél-szélessége mp-ben (default 10) */
  windowSec?: number;
  /** max. nearby klip (default 6) */
  maxNearby?: number;
}

export interface ClipSummary {
  id: string;
  kind: Clip['kind'];
  track: string;
  start: number;
  end: number;
  /** rövid címke: szöveg-tartalom / név / forrás — a nehéz mezők NÉLKÜL */
  label?: string;
}

export interface AiContext {
  project: {
    name: string;
    kind: string;
    aspectRatio: string;
    fps: number;
    durationSec: number;
    trackCount: number;
  };
  tracks: { type: string; clipCount: number }[];
  seo?: { title?: string; hashtags?: string[] };
  /** a kijelölt klip (ha van) */
  selected?: ClipSummary;
  /** a lejátszófej körüli klipek (a selectedet nem ismételve) */
  nearby: ClipSummary[];
}

/** Rövid, token-hatékony címke egy klipből (a nehéz mezők nélkül). */
function clipLabel(clip: Clip): string | undefined {
  const c = clip as unknown as Record<string, unknown>;
  if (clip.kind === 'text' && typeof c.text === 'string') {
    return (c.text as string).slice(0, 80);
  }
  if (typeof c.name === 'string') {
    return (c.name as string).slice(0, 80);
  }
  if (clip.kind === 'shape' && typeof c.shape === 'string') {
    return c.shape as string;
  }
  if (typeof c.uri === 'string') {
    const uri = c.uri as string;
    return uri.split('/').pop()?.slice(0, 80);
  }
  return undefined;
}

function summarize(clip: Clip, trackType: string): ClipSummary {
  return {
    id: clip.id,
    kind: clip.kind,
    track: trackType,
    start: clip.start,
    end: clipEnd(clip),
    label: clipLabel(clip),
  };
}

/** Egy klip „közel van-e" a lejátszófejhez (átfed, vagy az ablakon belül). */
function nearPlayhead(clip: Clip, playhead: number, windowSec: number): boolean {
  const s = clip.start;
  const e = clipEnd(clip);
  return e >= playhead - windowSec && s <= playhead + windowSec;
}

/** A három-rétegű AI-kontextus összeállítása (Global + Current + Relevant). */
export function buildAiContext(project: Project, focus: AiContextFocus = {}): AiContext {
  const windowSec = focus.windowSec ?? 10;
  const maxNearby = focus.maxNearby ?? 6;
  const playhead = focus.playhead ?? 0;

  const tracks = project.tracks.map((t) => ({ type: t.type, clipCount: t.clips.length }));

  let selected: ClipSummary | undefined;
  const nearby: ClipSummary[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (focus.selectedClipId && clip.id === focus.selectedClipId) {
        selected = summarize(clip, track.type);
      }
    }
  }
  // relevant: a playhead körüli klipek (a selectedet kihagyva), a legközelebbiek elöl
  const candidates: { s: ClipSummary; dist: number }[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === focus.selectedClipId) {
        continue;
      }
      if (nearPlayhead(clip, playhead, windowSec)) {
        const mid = clip.start + (clipEnd(clip) - clip.start) / 2;
        candidates.push({ s: summarize(clip, track.type), dist: Math.abs(mid - playhead) });
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  for (const c of candidates.slice(0, maxNearby)) {
    nearby.push(c.s);
  }

  return {
    project: {
      name: project.name,
      kind: (project as { kind?: string }).kind ?? 'video',
      aspectRatio: project.aspectRatio,
      fps: (project as { fps?: number }).fps ?? 30,
      durationSec: Math.round(projectDuration(project) * 100) / 100,
      trackCount: project.tracks.length,
    },
    tracks,
    seo: project.seo
      ? { title: project.seo.title, hashtags: project.seo.hashtags }
      : undefined,
    selected,
    nearby,
  };
}

/** A kontextus kompakt szöveggé (az AI-prompt elé fűzhető). */
export function contextToPrompt(ctx: AiContext): string {
  const lines: string[] = [];
  const p = ctx.project;
  lines.push(`Projekt: "${p.name}" (${p.kind}, ${p.aspectRatio}, ${p.fps}fps, ${p.durationSec}s, ${p.trackCount} sáv)`);
  lines.push(`Sávok: ${ctx.tracks.map((t) => `${t.type}×${t.clipCount}`).join(', ')}`);
  if (ctx.seo?.hashtags?.length) {
    lines.push(`Hashtagek: ${ctx.seo.hashtags.join(' ')}`);
  }
  if (ctx.selected) {
    const s = ctx.selected;
    lines.push(`Kijelölt: ${s.kind} "${s.label ?? ''}" @${s.start}-${s.end}s (${s.track})`);
  }
  if (ctx.nearby.length) {
    lines.push(
      `Közeli klipek: ${ctx.nearby.map((c) => `${c.kind}"${c.label ?? ''}"@${c.start}s`).join('; ')}`,
    );
  }
  return lines.join('\n');
}
