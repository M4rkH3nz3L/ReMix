import { t as tr } from 'i18next';

import { AI_PROBE_TIMEOUT_MS, aiFetch, aiPostJson } from '@/lib/aiFetch';
import { aiConfigForTask } from '@/lib/aiProviders';
import { renderServerUrl } from '@/lib/render';

import type { AssistantReply } from '@/lib/aiCommands';

/**
 * AI-asszisztens hálózati kliense — a pure kontextus-építő és parancs-mapper
 * az aiCommands.ts-ben van (expo-mentes, tesztelhető).
 */

/** A worker AI-válaszának lekérése. */
export async function askAssistant(
  context: Record<string, unknown>,
  instruction: string
): Promise<AssistantReply> {
  const base = renderServerUrl();
  // a felhasználó saját modellje (BYOK), ha be van állítva — ekkor a worker
  // env-AI-ja nem is kell
  const aiConfig = await aiConfigForTask('assistant');
  let health: { ai?: boolean };
  try {
    const res = await aiFetch(`${base}/health`, {}, AI_PROBE_TIMEOUT_MS);
    health = await res.json();
  } catch {
    throw new Error(tr('lib.ai.workerUnreachable', { base }));
  }
  // saját modellel akkor is megy, ha a workeren nincs env-AI
  if (!health.ai && !aiConfig) {
    throw new Error(tr('lib.ai.workerNoAi'));
  }
  // időkorláttal: a lokális modell beragadhat, és időkorlát nélkül az app
  // örökké várna (a felhasználó azt látja, hogy „nem történik semmi")
  return aiPostJson<AssistantReply>(
    `${base}/ai/assist`,
    { context, instruction, aiConfig },
    tr('lib.ai.assistCallFailed')
  );
}
