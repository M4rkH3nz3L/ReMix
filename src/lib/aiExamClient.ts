import { aiFetch } from '@/lib/aiFetch';
import {
  evaluateExamResponse,
  examFixtureProject,
  examRequestForTask,
  providerFingerprint,
} from '@/lib/aiExam';
import {
  AI_PROVIDER_KINDS,
  AI_TASKS,
  saveProviderExam,
  type AiProvider,
  type AiTask,
} from '@/lib/aiProviders';
import { renderServerUrl } from '@/lib/render';

/**
 * 🧪 Feladat-vizsga futtató (local-ai 5.3) — a tiszta vizsga-mag
 * ([aiExam](./aiExam.ts)) hálózati oldala. A providert MINDEN feladaton
 * végigvizsgáztatja a valós worker-végpontokon (a vizsgált provider
 * `aiConfig`-jával — a user saját kulcsát terheli, az env-AI-t nem), az
 * eredményt determinisztikusan értékeli, és CSAK a sikeres feladatokat menti a
 * `validated_tasks`-ba. A Pro-kapus végpont free tieren `blocked` (nem a modell
 * hibája — ott a tier a kapu, a vizsga Pro-val pótolható).
 */

export interface ProviderExamResult {
  task: AiTask;
  ok: boolean;
  /** tier-kapu fogta meg (402/403) — nem a modell bukott */
  blocked?: boolean;
  reason?: string;
}

/** egy vizsga-hívás időkorlátja — valódi generálás, a probe-nál lassabb */
const EXAM_TIMEOUT_MS = 45_000;

async function runSingleExam(
  provider: AiProvider,
  task: AiTask,
): Promise<ProviderExamResult> {
  const fixture = examFixtureProject();
  const req = examRequestForTask(task, fixture);
  const aiConfig = {
    provider: provider.provider,
    baseUrl: provider.baseUrl.trim() || AI_PROVIDER_KINDS[provider.provider].defaultBaseUrl,
    model: provider.model,
    apiKey: provider.apiKey ?? '',
  };
  try {
    const res = await aiFetch(
      `${renderServerUrl()}${req.path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...req.body, aiConfig }),
      },
      EXAM_TIMEOUT_MS,
    );
    if (res.status === 402 || res.status === 403) {
      return { task, ok: false, blocked: true, reason: 'tier' };
    }
    if (!res.ok) {
      return { task, ok: false, reason: `HTTP ${res.status}` };
    }
    const body: unknown = await res.json().catch(() => null);
    const verdict = evaluateExamResponse(task, body, fixture);
    return verdict.ok ? { task, ok: true } : { task, ok: false, reason: verdict.reason };
  } catch {
    return { task, ok: false, reason: 'network' };
  }
}

/**
 * A provider teljes vizsgája: minden feladat SORBAN (nem terheljük párhuzamosan
 * a provider-kulcsot), az eredmény mentve (`validated_tasks` + ujjlenyomat).
 * A mentés-hiba nem dob — a vizsga eredménye így is visszamegy a hívónak.
 */
export async function examineProvider(provider: AiProvider): Promise<ProviderExamResult[]> {
  const results: ProviderExamResult[] = [];
  for (const task of AI_TASKS) {
    results.push(await runSingleExam(provider, task));
  }
  const passed = results.filter((r) => r.ok).map((r) => r.task);
  try {
    await saveProviderExam(provider.id, passed, providerFingerprint(provider));
  } catch {
    // offline/migráció-hiány esetén a mentés kimarad — a következő mentés pótolja
  }
  return results;
}
