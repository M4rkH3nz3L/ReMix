import { aiFetch } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import { ensureCloud } from '@/lib/backend';
import { projectDuration } from '@/lib/projectUtils';
import { getTimelineTranscript } from '@/lib/transcripts';
import type { ChapterKind, Project } from '@/types/project';

/**
 * 🎬 AI Story Engine hálózati rétege (Phase 1.1): a beszéd-átirat + a hossz
 * alapján a worker AI-ja felismeri a short-form dramaturgiát (Hook → Context →
 * Value → CTA), és fejezet-kezdeteket ad vissza a Story lane-hez.
 *
 * Pro-funkció (`ensureCloud('storyAnalyze')` → nincs Pro esetén ProRequiredError,
 * amit a hívó `guardPro`-val paywallra fordít). Az átirat best-effort: ha nincs
 * (web / nincs worker / túl hosszú), a modell a hosszból ad időarányos ívet.
 */

const KINDS: ChapterKind[] = ['hook', 'context', 'value', 'cta', 'other'];

export interface StoryChapter {
  start: number;
  kind: ChapterKind;
}

/** Story-struktúra felismerése. `null`, ha nincs értékelhető eredmény. */
export async function runStoryFlow(project: Project): Promise<StoryChapter[] | null> {
  // Pro-kapu + felhő-cím egy lépésben (nem-Pro → ProRequiredError)
  const base = ensureCloud('storyAnalyze');
  const duration = projectDuration(project);
  if (duration <= 0.05) {
    return null;
  }

  const transcript = (await getTimelineTranscript(project).catch(() => null)) ?? [];
  const aiConfig = await aiConfigForTask('storyStructure');

  const res = await aiFetch(`${base}/ai/story`, {
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
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { chapters?: { start?: unknown; kind?: unknown }[] };

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
