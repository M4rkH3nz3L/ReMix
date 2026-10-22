import { buildKeepPlan, speechSegments, type TimeRange } from '@/lib/autoedit';
import type { EditorCommand } from '@/lib/commands';
import { projectFps, snapToFrame } from '@/lib/frames';
import { projectDuration } from '@/lib/projectUtils';
import type { TranscriptLine } from '@/lib/transcripts';
import type { Project } from '@/types/project';

/**
 * 🔇 VAD → vágásterv — tiszta mag (local-ai Fázis A/3).
 *
 * Bemenet: beszéd-szegmensek az IDŐVONAL idejében (a VAD-motorból — Silero a
 * whisper.rn-ben, vagy a worker-átirat szegmensei). Kimenet: frame-rácsra
 * igazított keep-ablakok + EGYETLEN `REPLACE_TRACK_CLIPS` parancs (undo-safe,
 * a meglévő `buildKeepPlan` trim/sebesség-helyes darabolásával). A motor-hívás
 * a kliens-rétegben él; ez a mag determinista és önmagában tesztelt.
 *
 * A küszöbök paraméterek: a `minSilenceSec`-nél RÖVIDEBB csend nem vágódik ki
 * (természetes levegővétel), a `padSec` a beszéd-szélekre hagyott levegő, a
 * `minKeepSec`-nél rövidebb megtartott darab kiesik (villanás-klip ellen).
 */

export interface SilencePlanOptions {
  /** ennél rövidebb csendet nem vágunk ki (mp) */
  minSilenceSec?: number;
  /** levegő a beszéd-szegmensek szélein (mp) */
  padSec?: number;
  /** ennél rövidebb keep-darab kiesik (mp) */
  minKeepSec?: number;
}

const DEFAULTS: Required<SilencePlanOptions> = {
  minSilenceSec: 0.6,
  padSec: 0.12,
  minKeepSec: 0.25,
};

/** átfedő/érintkező sávok összeolvasztása (rendezve) */
function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Beszéd-szegmensek → kivágható csendek. A pad-dal megnövelt beszéd-ablakok
 * KÖZTI rések csak akkor csendek, ha elérik a `minSilenceSec`-et.
 */
export function silencesFromSpeech(
  speech: TimeRange[],
  totalSec: number,
  opts: SilencePlanOptions = {},
): TimeRange[] {
  const o = { ...DEFAULTS, ...opts };
  if (totalSec <= 0) {
    return [];
  }
  const padded = mergeRanges(
    speech
      .filter((s) => s.end > s.start)
      .map((s) => ({
        start: Math.max(0, s.start - o.padSec),
        end: Math.min(totalSec, s.end + o.padSec),
      })),
  );
  if (padded.length === 0) {
    // nincs beszéd → az egész egy csend, de ezt NEM vágjuk (nincs mire vágni)
    return [];
  }
  const silences: TimeRange[] = [];
  let cursor = 0;
  for (const seg of padded) {
    if (seg.start - cursor >= o.minSilenceSec) {
      silences.push({ start: cursor, end: seg.start });
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (totalSec - cursor >= o.minSilenceSec) {
    silences.push({ start: cursor, end: totalSec });
  }
  return silences;
}

/** Csendek → megtartandó ablakok, frame-rácsra igazítva (AGENTS: vágás a rácson!). */
export function keepsFromSilences(
  silences: TimeRange[],
  totalSec: number,
  fps: number,
  opts: SilencePlanOptions = {},
): TimeRange[] {
  const o = { ...DEFAULTS, ...opts };
  if (totalSec <= 0) {
    return [];
  }
  const merged = mergeRanges(silences.filter((s) => s.end > s.start));
  const keeps: TimeRange[] = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start > cursor) {
      keeps.push({ start: cursor, end: Math.min(s.start, totalSec) });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < totalSec) {
    keeps.push({ start: cursor, end: totalSec });
  }
  return keeps
    .map((k) => ({ start: snapToFrame(k.start, fps), end: snapToFrame(k.end, fps) }))
    .filter((k) => k.end - k.start >= o.minKeepSec);
}

export interface SilenceCutPlan {
  /** a megtartott ablakok (frame-igazítva) — az előnézet/összegző ebből számol */
  keeps: TimeRange[];
  /** kivágott idő összesen (mp) */
  removedSec: number;
  /** vágások száma az új idővonalon */
  cuts: number;
  /** EGY undo-lépés: a videósáv újraépítése a keep-darabokból */
  commands: EditorCommand[];
}

/**
 * A teljes csend-vágás terve a projektre. `null`, ha nincs mit vágni (nincs
 * elég hosszú csend, vagy nem maradna értékelhető tartalom). A dispatch a hívó
 * dolga (`applyBatch(plan.commands, 'ai')`) — a mag nem ír state-et.
 */
export function planSilenceCut(
  project: Project,
  speech: TimeRange[],
  opts: SilencePlanOptions = {},
): SilenceCutPlan | null {
  const totalSec = projectDuration(project);
  const fps = projectFps(project);
  const silences = silencesFromSpeech(speech, totalSec, opts);
  if (silences.length === 0) {
    return null;
  }
  const keeps = keepsFromSilences(silences, totalSec, fps, opts);
  if (keeps.length === 0) {
    return null;
  }
  const clips = buildKeepPlan(project, keeps);
  if (clips.length === 0) {
    return null;
  }
  const keptSec = keeps.reduce((s, k) => s + (k.end - k.start), 0);
  return {
    keeps,
    removedSec: Math.max(0, totalSec - keptSec),
    cuts: Math.max(0, clips.length - 1),
    commands: [{ type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips }],
  };
}

/**
 * Csend-vágás terve ÁTIRATBÓL (a teljes on-device lánc második fele): a
 * whisper-sorokból (`transcribeWavOnDevice` / worker-átirat — azonos formátum)
 * az `autoedit.speechSegments` csinál beszéd-sávokat (kis rések összeolvasztva,
 * szél-pad), a többi út azonos a `planSilenceCut`-tal. VAD-motor nélkül is
 * működik — a Silero-út később csak pontosítja a szegmenseket.
 */
export function planSilenceCutFromTranscript(
  project: Project,
  lines: TranscriptLine[],
  opts: SilencePlanOptions = {},
): SilenceCutPlan | null {
  return planSilenceCut(project, speechSegments(lines), opts);
}
