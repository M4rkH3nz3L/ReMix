/**
 * ⏱️ Közös AI-hívás időkorláttal.
 *
 * MIÉRT: a lokális modell (Ollama) néha percekig gondolkodik vagy beragad.
 * Időkorlát nélkül az app VÉGTELENÜL vár — a gép ventilátora búg, a
 * felhasználó pedig azt látja, hogy „nem történik semmi". Ez volt a
 * leggyakoribb panasz, és minden AI-kliensre igaz volt.
 *
 * A hívás megszakítható és MINDIG beszédes hibával tér vissza, hogy a
 * felhasználó tudja: elakadt, nem ő rontott el valamit.
 */

import { t as tr } from 'i18next';

/** alapértelmezett várakozás: a lokális modell bemelegedve 3–8 mp, de az első
 *  hívás modell-betöltéssel jár, ezért bőkezű a keret */
export const AI_TIMEOUT_MS = 90_000;
/** rövid, „él-e a worker" jellegű kérdésekre */
export const AI_PROBE_TIMEOUT_MS = 4_000;

export class AiTimeoutError extends Error {
  constructor(seconds: number) {
    super(tr('lib.aiFetch.timeout', { seconds }));
    this.name = 'AiTimeoutError';
  }
}

/**
 * `fetch` időkorláttal. A megszakítást megkülönböztetjük a hálózati hibától,
 * mert a felhasználónak MÁS a teendője a kettőnél.
 */
export async function aiFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = AI_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new AiTimeoutError(Math.round(timeoutMs / 1000));
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-kérés időkorláttal + egységes hibaüzenet (ez a leggyakoribb minta) */
export async function aiPostJson<T>(
  url: string,
  body: unknown,
  fallbackError: string,
  timeoutMs = AI_TIMEOUT_MS
): Promise<T> {
  const res = await aiFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((parsed as { error?: string }).error ?? fallbackError);
  }
  return parsed as T;
}
