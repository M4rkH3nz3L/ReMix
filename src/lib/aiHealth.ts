import { AI_PROBE_TIMEOUT_MS, aiFetch } from '@/lib/aiFetch';
import { AI_PROVIDER_KINDS, type AiProvider } from '@/lib/aiProviders';
import { cloudBaseUrl } from '@/lib/backend';

/**
 * 🟢 Provider-health (kliens): elérhető-e a modell? A hívást a WORKER végzi
 * (CORS/SSRF miatt a kliens nem pingelheti közvetlenül a provider-végpontokat),
 * ezért a worker /ai/probe-ját hívjuk. Bármilyen hiba / worker-hiány → `false`
 * (a picker ilyenkor kiszürkíti és nem engedi kijelölni a modellt).
 */
export async function probeProvider(p: AiProvider): Promise<boolean> {
  try {
    const cfg = {
      provider: p.provider,
      baseUrl: p.baseUrl?.trim() || AI_PROVIDER_KINDS[p.provider].defaultBaseUrl,
      model: p.model,
      apiKey: p.apiKey ?? '',
    };
    const res = await aiFetch(
      `${cloudBaseUrl()}/ai/probe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig: cfg }),
      },
      AI_PROBE_TIMEOUT_MS + 2_000 // a worker 4 mp-es próbája járjon le előbb
    );
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { ok?: boolean };
    return !!body.ok;
  } catch {
    return false;
  }
}
