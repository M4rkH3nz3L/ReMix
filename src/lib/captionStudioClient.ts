import { aiFetch, aiPostJsonOrNull } from '@/lib/aiFetch';
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
    const body = await aiPostJsonOrNull<{ segments: CaptionSuggestion[] }>(
      `${ensureCloud('autoCaption')}/ai/captionstudio`,
      { segments, aiConfig }
    );
    return body && Array.isArray(body.segments) ? body.segments : null;
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
  // a `.catch()` nélkül egy nem-JSON válasz (502 / proxy-hibaoldal) „JSON Parse
  // error"-t dobna a felhasználó arcába; így csak „nincs fordítás" lesz belőle
  const body = (await res.json().catch(() => ({}))) as {
    segments?: { id: string; text: string }[];
  };
  return Array.isArray(body.segments) ? body.segments : null;
}
