import { aiFetch } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import type { CaptionSuggestion } from '@/lib/captionStudio';
import { ensureCloud } from '@/lib/backend';

/**
 * ✨ Caption Studio hálózati kliens: a worker AI-rétege (lokális modell vagy
 * Claude) javasol kiemelt szavakat + emojit a felirat-szegmensekre.
 * Hiba/worker-hiány esetén null — a hívó a heurisztikus fallbackre vált.
 */
export async function fetchCaptionSuggestions(
  segments: { id: string; text: string }[]
): Promise<CaptionSuggestion[] | null> {
  try {
    const aiConfig = await aiConfigForTask('captionStudio');
    const res = await aiFetch(`${ensureCloud('autoCaption')}/ai/captionstudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, aiConfig }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { segments: CaptionSuggestion[] };
    return Array.isArray(body.segments) ? body.segments : null;
  } catch {
    return null;
  }
}

/**
 * 🌍 Felirat-fordítás (Phase 4.2): a felirat-szegmensek (id + text) fordítása a
 * cél-nyelvre. Szándékosan NEM nyeli el a hibát — a `ProRequiredError` (nincs
 * Pro) propagál, hogy a hívó `guardPro`-val paywallt nyisson.
 */
export async function fetchCaptionTranslations(
  segments: { id: string; text: string }[],
  lang: string
): Promise<{ id: string; text: string }[] | null> {
  const base = ensureCloud('autoCaption'); // nem-Pro → ProRequiredError (propagál)
  const aiConfig = await aiConfigForTask('captionStudio');
  const res = await aiFetch(`${base}/ai/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, lang, aiConfig }),
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { segments?: { id: string; text: string }[] };
  return Array.isArray(body.segments) ? body.segments : null;
}
