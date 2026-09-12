import { aiFetch } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import { ensureCloud } from '@/lib/backend';
import { projectDuration } from '@/lib/projectUtils';
import { getTimelineTranscript } from '@/lib/transcripts';
import type { Project } from '@/types/project';

/**
 * 🎯 AI Rough Cut → shorts (Phase 3.3): hosszú anyagból több ÖNÁLLÓ short-jelölt
 * (highlight-ablak) a beszéd-átirat + hossz alapján. Nem módosít semmit — csak
 * felkínálja a legütősebb, önmagukban is megálló szakaszokat (cím + időtartomány
 * + indok), amikre a lejátszófej ráugorhat.
 *
 * Pro-funkció: `ensureCloud('autoEdit')` (az AI rough-cut képessége alá tartozik).
 */

export interface Highlight {
  start: number;
  end: number;
  title: string;
  reason: string;
}

const MIN_LEN = 4;

/** Short-jelöltek keresése. `null`, ha nincs értékelhető eredmény. */
export async function findHighlights(project: Project): Promise<Highlight[] | null> {
  const base = ensureCloud('autoEdit'); // Pro-kapu
  const duration = projectDuration(project);
  if (duration <= MIN_LEN) {
    return null;
  }
  const transcript = (await getTimelineTranscript(project).catch(() => null)) ?? [];
  const aiConfig = await aiConfigForTask('autoEdit');

  const res = await aiFetch(`${base}/ai/highlights`, {
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
  const body = (await res.json()) as { highlights?: Partial<Highlight>[] };

  const raw = (body.highlights ?? [])
    .filter(
      (h) =>
        h &&
        typeof h.start === 'number' &&
        typeof h.end === 'number' &&
        (h.end as number) - (h.start as number) >= MIN_LEN
    )
    .map((h) => ({
      start: Math.max(0, Math.round((h.start as number) * 100) / 100),
      end: Math.min(duration, Math.round((h.end as number) * 100) / 100),
      title: String(h.title ?? '').slice(0, 60),
      reason: String(h.reason ?? '').slice(0, 200),
    }))
    .filter((h) => h.end - h.start >= MIN_LEN)
    .sort((a, b) => a.start - b.start);

  // átfedések eldobása (a korábbit tartjuk), max 4
  const out: Highlight[] = [];
  for (const h of raw) {
    if (out.length >= 4) {
      break;
    }
    if (out.every((o) => h.start >= o.end - 0.01)) {
      out.push(h);
    }
  }
  return out.length > 0 ? out : null;
}
