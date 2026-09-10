/**
 * SRT (SubRip) felirat-kezelés: az auto-caption pipeline-ok (Whisper, YouTube,
 * CapCut-export) szabvány kimenete — importtal kész, időzített feliratsáv lesz
 * belőle, exporttal pedig bármely platformra vihető a felirat.
 * Szándékosan expo-mentes, hogy önmagában tesztelhető legyen; a fájlválasztó a
 * lib/media.ts-ben van.
 */

export interface SrtCue {
  /** mp */
  start: number;
  /** mp */
  end: number;
  text: string;
}

/** "HH:MM:SS,mmm" → mp (a pont-os változatot is elfogadjuk) */
function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) {
    return null;
  }
  return (
    parseInt(m[1], 10) * 3600 +
    parseInt(m[2], 10) * 60 +
    parseInt(m[3], 10) +
    parseInt(m[4].padEnd(3, '0'), 10) / 1000
  );
}

function toTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
}

export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = [];
  // blokkok üres sorral elválasztva; BOM és CRLF normalizálva
  const blocks = content.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      continue;
    }
    // az első sor lehet sorszám — akkor a második az időzítés
    const timeLineIdx = lines[0].includes('-->') ? 0 : 1;
    const timeLine = lines[timeLineIdx];
    if (!timeLine || !timeLine.includes('-->')) {
      continue;
    }
    const [rawStart, rawEnd] = timeLine.split('-->');
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    if (start === null || end === null || end <= start) {
      continue;
    }
    const text = lines
      .slice(timeLineIdx + 1)
      .join('\n')
      .trim();
    if (text.length > 0) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** cue-leképezéshez elegendő klip-nézet (a VideoClip részhalmaza) */
export interface CueMapClip {
  uri: string;
  start: number;
  duration: number;
  trimIn: number;
  speed: number;
}

/**
 * Forrás-idejű cue-k leképezése az idővonalra a videóklipek trim/sebesség
 * ablakain át: a levágott részek cue-i kimaradnak, az átlógók levágódnak,
 * a felgyorsított klipeké arányosan rövidül. Pure függvény.
 */
export function mapCuesToTimeline(
  clips: CueMapClip[],
  cuesByUri: Map<string, SrtCue[]>,
  minDuration = 0.3
): SrtCue[] {
  const out: SrtCue[] = [];
  for (const clip of clips) {
    const cues = cuesByUri.get(clip.uri) ?? [];
    const srcIn = clip.trimIn;
    const srcOut = clip.trimIn + clip.duration * clip.speed;
    for (const cue of cues) {
      if (cue.end <= srcIn || cue.start >= srcOut) {
        continue; // a levágott részhez tartozik
      }
      const start = clip.start + (Math.max(cue.start, srcIn) - srcIn) / clip.speed;
      const end = clip.start + (Math.min(cue.end, srcOut) - srcIn) / clip.speed;
      if (end - start < minDuration) {
        continue;
      }
      out.push({ start, end, text: cue.text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function serializeSrt(cues: SrtCue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${toTimestamp(cue.start)} --> ${toTimestamp(cue.end)}\n${cue.text}`
    )
    .join('\n\n')
    .concat('\n');
}

