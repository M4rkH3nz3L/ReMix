import { aiPostJsonOrNull } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import type { HookSuggestion } from '@/lib/hooks';
import { localHooks } from '@/lib/localTasks';
import { renderServerUrl } from '@/lib/render';

/**
 * 🪝 Hook Generator hálózati kliens: a worker AI-rétege (lokális modell vagy
 * Claude) 6 különböző stílusú nyitómondatot ír a videó témájára.
 * 🧩 Worker/AI nélkül a LOKÁL sablon-út ad javaslatot (ingyen, offline) —
 * a hívó nem különböztet, a funkció sosem „üres".
 */
export async function fetchHooks(summary: string): Promise<HookSuggestion[] | null> {
  try {
    const aiConfig = await aiConfigForTask('hooks');
    // időkorláttal — enélkül a beragadt lokális modell örökre elnyelné a hívást.
    // A helper a nem-JSON választ (502 / proxy-hibaoldal) is `null`-ra fordítja,
    // szemben a korábbi nyers `res.json()`-nel, ami ilyenkor DOBOTT.
    const body = await aiPostJsonOrNull<{ hooks: HookSuggestion[] }>(
      `${renderServerUrl()}/ai/hooks`,
      { summary, aiConfig }
    );
    if (!body) {
      return localHooks(summary);
    }
    const list = (body.hooks ?? [])
      .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
      .map((h) => ({ text: h.text.trim(), style: String(h.style ?? '').trim() }))
      .slice(0, 6);
    return list.length > 0 ? list : localHooks(summary);
  } catch {
    return localHooks(summary);
  }
}
