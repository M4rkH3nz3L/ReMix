import { aiFetch } from '@/lib/aiFetch';
import type { HookSuggestion } from '@/lib/hooks';
import { renderServerUrl } from '@/lib/render';

/**
 * 🪝 Hook Generator hálózati kliens: a worker AI-rétege (lokális modell vagy
 * Claude) 6 különböző stílusú nyitómondatot ír a videó témájára.
 */
export async function fetchHooks(summary: string): Promise<HookSuggestion[] | null> {
  try {
    // időkorláttal — enélkül a beragadt lokális modell örökre elnyelné a hívást
    const res = await aiFetch(`${renderServerUrl()}/ai/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { hooks: HookSuggestion[] };
    const list = (body.hooks ?? [])
      .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
      .map((h) => ({ text: h.text.trim(), style: String(h.style ?? '').trim() }))
      .slice(0, 6);
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}
