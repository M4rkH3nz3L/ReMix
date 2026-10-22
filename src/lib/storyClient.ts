import { aiFetch } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import { ensureCloud } from '@/lib/backend';
import { localStoryChapters } from '@/lib/localTasks';
import { projectDuration } from '@/lib/projectUtils';
import { getTimelineTranscript } from '@/lib/transcripts';
import type { ChapterKind, Project } from '@/types/project';

/**
 * 🎬 AI Story Engine hálózati rétege (Phase 1.1): a beszéd-átirat + a hossz
 * alapján a worker AI-ja felismeri a short-form dramaturgiát (Hook → Context →
 * Value → CTA), és fejezet-kezdeteket ad vissza a Story lane-hez.
 *
 * A FELHŐ-út Pro-funkció (`ensureCloud('storyAnalyze')`); 🧩 nem-Pro / worker-
 * hiba esetén a LOKÁL időarányos ív jön (`localStoryChapters` — ingyen,
 * offline), így a Story lane mindenkinek működik. Az átirat best-effort: ha
 * nincs, a modell/lokál-út a hosszból ad időarányos ívet.
 */

const KINDS: ChapterKind[] = ['hook', 'context', 'value', 'cta', 'other'];

export interface StoryChapter {
  start: number;
  kind: ChapterKind;
}

/** Story-struktúra felismerése. `null`, ha nincs értékelhető eredmény. */
export async function runStoryFlow(project: Project): Promise<StoryChapter[] | null> {
  const duration = projectDuration(project);
  if (duration <= 0.05) {
    return null;
  }
  const transcript = (await getTimelineTranscript(project).catch(() => null)) ?? [];

  let base: string;
  try {
    // Pro-kapu + felhő-cím egy lépésben (nem-Pro → lokál ív, nem paywall)
    base = ensureCloud('storyAnalyze');
  } catch {
    return localStoryChapters(duration, transcript);
  }
  const aiConfig = await aiConfigForTask('storyStructure');

  let res: Awaited<ReturnType<typeof aiFetch>>;
  try {
    res = await storyRequest(base, duration, transcript, aiConfig);
  } catch {
    return localStoryChapters(duration, transcript);
  }
  if (!res.ok) {
    return localStoryChapters(duration, transcript);
  }
  const chapters = await parseChapters(res, duration);
  return chapters ?? localStoryChapters(duration, transcript);
}

async function storyRequest(
  base: string,
  duration: number,
  transcript: { start: number; end: number; text: string }[],
  aiConfig: Awaited<ReturnType<typeof aiConfigForTask>>,
) {
  return aiFetch(`${base}/ai/story`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        duration: Math.round(duration * 100) / 100,
        transcript: transcript
          .slice(0, 200)
          .map((l) => ({
            start: Math.round(l.start * 100) / 100,
            end: Math.round(l.end * 100) / 100,
            text: l.text,
          })),
      },
      aiConfig,
    }),
  });
}

/** A worker-válasz normalizálása fejezet-listává; `null`, ha nincs értékelhető. */
async function parseChapters(
  res: Awaited<ReturnType<typeof aiFetch>>,
  duration: number,
): Promise<StoryChapter[] | null> {
  const body = (await res.json().catch(() => ({}))) as {
    chapters?: { start?: unknown; kind?: unknown }[];
  };

  // normalizálás: érvényes start (0..hossz), ismert kind, időrend + közeli dedup
  const raw = (body.chapters ?? [])
    .filter((c) => c && typeof c.start === 'number' && Number.isFinite(c.start))
    .map((c) => ({
      start: Math.min(Math.max(0, Math.round((c.start as number) * 100) / 100), duration),
      kind: (KINDS.includes(c.kind as ChapterKind) ? c.kind : 'other') as ChapterKind,
    }))
    .sort((a, b) => a.start - b.start);

  const chapters: StoryChapter[] = [];
  for (const c of raw) {
    // egymáshoz túl közeli fejezetek egybeolvasztása (≈negyed mp)
    if (!chapters.some((d) => Math.abs(d.start - c.start) < 0.25)) {
      chapters.push(c);
    }
  }
  return chapters.length > 0 ? chapters : null;
}
