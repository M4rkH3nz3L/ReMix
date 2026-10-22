import { t as tr } from 'i18next';

import { speechSegments } from '@/lib/autoedit';
import type { Highlight } from '@/lib/highlightsClient';
import type { HookSuggestion } from '@/lib/hooks';
import type { StoryChapter } from '@/lib/storyClient';
import type { TranscriptLine } from '@/lib/transcripts';

/**
 * 🧩 Lokális (ingyenes) AI-feladat magok — determinista sablonok/szabályok
 * (local-ai: „mindenből legyen ingyenes local").
 *
 * Minden AI-feladatnak van helyi gyors-útja, ami offline, kvóta és előfizetés
 * nélkül is ad használható eredményt; a felhő-modell opcionális MINŐSÉG-lépcső,
 * nem feltétel. A kliens-rétegek (hooksClient/thumbStudio/storyClient) ezekre
 * esnek vissza, ha nincs worker/AI/Pro — a hívó UI nem különböztet. A caption
 * (`captionStudio.heuristicSuggestions`) és az autoEdit (`autoedit.
 * heuristicVariants`) lokál-útja már korábban megvolt; ez a modul a maradék
 * hármat adja. Expo-mentes, tiszta → önmagában tesztelt.
 */

/** a téma-kivonat: az összefoglaló első értelmes darabja a sablonokhoz */
export function topicOf(summary: string, maxLen = 48): string {
  const clean = (summary ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLen) {
    return clean;
  }
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/** 🪝 6 nyitómondat sablonból — a worker-út ingyenes/offline megfelelője. */
export function localHooks(summary: string): HookSuggestion[] {
  const topic = topicOf(summary);
  return [
    { text: tr('lib.localTasks.hookQuestion', { topic }), style: tr('lib.localTasks.styleQuestion') },
    { text: tr('lib.localTasks.hookSecret', { topic }), style: tr('lib.localTasks.styleSecret') },
    { text: tr('lib.localTasks.hookMistake', { topic }), style: tr('lib.localTasks.styleMistake') },
    { text: tr('lib.localTasks.hookResult', { topic }), style: tr('lib.localTasks.styleResult') },
    { text: tr('lib.localTasks.hookChallenge', { topic }), style: tr('lib.localTasks.styleChallenge') },
    { text: tr('lib.localTasks.hookPov', { topic }), style: tr('lib.localTasks.stylePov') },
  ];
}

/** 🎬 3 borító-cím sablonból. */
export function localThumbHeadlines(summary: string): string[] {
  const topic = topicOf(summary, 36);
  return [
    tr('lib.localTasks.headlineBold', { topic }),
    tr('lib.localTasks.headlineHow', { topic }),
    tr('lib.localTasks.headlineNow', { topic }),
  ];
}

/**
 * 🎯 Short-jelöltek lokálisan: a leghosszabb összefüggő beszéd-szakaszok
 * (max 4, min 4 mp, 60 mp-re vágva) — a felhő-modell helyett alapszintű,
 * determinista kiválasztás az átiratból.
 */
export function localHighlights(
  transcript: TranscriptLine[],
  durationSec: number,
  { minLen = 4, maxLen = 60, max = 4 }: { minLen?: number; maxLen?: number; max?: number } = {},
): Highlight[] {
  const segs = speechSegments(transcript)
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(durationSec, s.end) }))
    .filter((s) => s.end - s.start >= minLen)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, max)
    .sort((a, b) => a.start - b.start);
  return segs.map((s, i) => ({
    start: Math.round(s.start * 100) / 100,
    end: Math.round(Math.min(s.end, s.start + maxLen) * 100) / 100,
    title: tr('lib.localTasks.highlightTitle', { n: i + 1 }),
    reason: tr('lib.localTasks.highlightReason'),
  }));
}

/** a short-form dramaturgia időarányos íve (a worker-prompt is ezt a mintát kéri) */
const STORY_ARC: { kind: StoryChapter['kind']; at: number }[] = [
  { kind: 'hook', at: 0 },
  { kind: 'context', at: 0.12 },
  { kind: 'value', at: 0.35 },
  { kind: 'cta', at: 0.85 },
];

/**
 * 🎬 Story-fejezetek lokálisan: időarányos Hook→Context→Value→CTA ív; ha van
 * átirat, a fejezet-kezdet a legközelebbi (±2 mp) beszéd-sor elejére pattan,
 * hogy a határ ne mondat közepére essen. Determinista.
 */
export function localStoryChapters(
  durationSec: number,
  transcript: TranscriptLine[] = [],
): StoryChapter[] {
  if (durationSec <= 0.5) {
    return [];
  }
  const starts = transcript.map((l) => l.start).sort((a, b) => a - b);
  const snap = (t: number): number => {
    let best = t;
    let bestDist = 2;
    for (const s of starts) {
      const d = Math.abs(s - t);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return Math.round(best * 100) / 100;
  };
  const out: StoryChapter[] = [];
  for (const { kind, at } of STORY_ARC) {
    const start = snap(Math.min(at * durationSec, Math.max(0, durationSec - 0.5)));
    // túl közeli/visszaugró fejezet kimarad (rövid videón az ív összecsúszna)
    if (out.length === 0 || start - out[out.length - 1].start >= 1) {
      out.push({ start, kind });
    }
  }
  return out;
}
