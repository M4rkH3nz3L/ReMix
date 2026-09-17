/**
 * 🔁 Újrapróbálkozás — SZÁNDÉKOSAN csak IDEMPOTENS OLVASÁSOKRA.
 *
 * A mobilhálózat pillanatnyi kimaradása (alagút, lift, wifi→LTE váltás) ma
 * végleges hibaként csapódik le a felhasználónál, pedig egy második próbálkozás
 * jellemzően átmegy. EZ azonban csak ott biztonságos, ahol a kérés MEGISMÉTLÉSE
 * nem jár mellékhatással.
 *
 * ⛔️ EZEKRE SOHA ne használd:
 *    /shop/purchase · /shop/credits/grant · /billing/* · /media/upload · /invite
 *    · /notify — ezek NEM idempotensek: egy timeout után a szerver lehet, hogy
 *    már végrehajtotta a műveletet, és az ismétlés DUPLA terhelést / dupla
 *    kreditet / dupla meghívót okozna. Ott a helyes viselkedés a hiba jelzése.
 *
 * ✅ Erre való: health-check, lista-lekérés, elemzés (beat/cut/depth/szín),
 *    státusz-poll, letöltés — mind ismételhető ugyanazzal az eredménnyel.
 *
 * Amit ÚJRAPRÓBÁL: hálózati hiba (offline, DNS, TLS-reset), 408, 425, 429,
 * és 5xx — tehát a „szerver most nem ér rá" esetek.
 * Amit NEM: 4xx (a kérés hibás — ismétléstől nem javul), és az ABORT (a
 * felhasználó/timeout megszakította — az ismétlés ellene dolgozna).
 */

/** alap-várakozás az első újrapróba előtt (ms); utána duplázódik */
const BASE_DELAY_MS = 400;
/** a backoff felső korlátja (ms) — mobilon a hosszú várakozás rosszabb, mint a hiba */
const MAX_DELAY_MS = 4000;
/** ennél tovább nem várunk a szerver `Retry-After` kérésére sem */
const MAX_RETRY_AFTER_MS = 10_000;

export interface RetryOptions {
  /** ÖSSZES próbálkozás (nem a ráadás) — alapérték 2, tehát egy újrapróba */
  attempts?: number;
  /** megszakítás: aborted jelnél azonnal feladjuk, nem várakozunk */
  signal?: AbortSignal;
  /** csak tesztnek: a várakozás beinjektálható, hogy ne teljen valós idő */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** az abort minden szinten végleges — se hiba-ismétlés, se várakozás */
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || e.message.toLowerCase().includes('abort'))
  );
}

/** ezek az állapotkódok múlékonyak: a kérés önmagában rendben volt */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * `Retry-After` fejléc → ms. A szerver tudja a legjobban, mikor ér rá;
 * a HTTP-dátum formát is érti. Ésszerűtlenül hosszú értéket eldobunk.
 */
export function retryAfterMs(res: { headers?: { get(name: string): string | null } }): number | null {
  const raw = res.headers?.get('retry-after');
  if (!raw) {
    return null;
  }
  const secs = Number(raw);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_RETRY_AFTER_MS) {
    return null;
  }
  return ms;
}

function backoffMs(attemptIndex: number): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
  // szórás: ha egy hálózat-kimaradás után MINDEN kliens egyszerre próbálkozna,
  // azzal mi döntenénk le a workert (thundering herd)
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/**
 * Egy IDEMPOTENS olvasás futtatása újrapróbálkozással.
 *
 * A `run` teljes fetch-hívás legyen (URL-lel, fejlécekkel együtt), mert minden
 * próbálkozás frissen hívja meg — egy elfogyasztott `Response`-t vagy egy már
 * felhasznált body-stream-et nem lehetne újrajátszani.
 *
 * A NEM újrapróbálható választ (pl. 404) változatlanul visszaadja — a hívó
 * ugyanazt a `Response`-t kapja, mintha nem is lett volna retry-réteg.
 */
export async function retryRead(
  run: () => Promise<Response>,
  opts: RetryOptions = {}
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    let res: Response | null = null;
    try {
      res = await run();
    } catch (e) {
      if (isAbortError(e) || opts.signal?.aborted) {
        throw e; // a megszakítás a felhasználó döntése — tiszteletben tartjuk
      }
      lastError = e;
    }

    if (res) {
      if (!isRetryableStatus(res.status) || i === attempts - 1) {
        return res; // sikeres VAGY végleges hiba VAGY elfogyott a próbálkozás
      }
      const after = retryAfterMs(res);
      await sleep(after ?? backoffMs(i));
      continue;
    }

    if (i === attempts - 1) {
      break;
    }
    await sleep(backoffMs(i));
  }

  throw lastError instanceof Error ? lastError : new Error('network request failed');
}

/**
 * 📥 A válasz-törzs JSON-ként — parse-hiba nélkül, beszédes üzenettel.
 *
 * A `await res.json()` hívás azonnal `SyntaxError`-t dob, ha a szerver NEM
 * JSON-t ad: 502-es proxy-hibaoldalt, Cloudflare-ellenőrzést, lejárt tunnel
 * HTML-jét. A felhasználó ilyenkor „JSON Parse error: Unexpected character: <"
 * üzenetet lát — ami se nem érthető, se nem segít. Ráadásul több hívóhelyen a
 * `.json()` MEGELŐZTE az `!res.ok` ágat, tehát épp az a kód nem futott le,
 * amelyik a normális hibaüzenetet adta volna.
 *
 * Itt a törzset EGYSZER olvassuk szövegként, és csak utána próbáljuk értelmezni.
 * Ha nem JSON, a hívó `fallback` üzenetét adjuk vissza a HTTP-státusszal — a
 * nyers HTML-t sosem mutatjuk a felhasználónak.
 *
 * Üres törzs + sikeres válasz esetén `{}` jön vissza (204 No Content), hogy a
 * hívó `body.valami ?? alapértelmezés` mintája továbbra is működjön.
 */
export async function readJson<T = Record<string, unknown>>(
  res: Response,
  fallback: string
): Promise<T> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) {
    if (res.ok) {
      return {} as T;
    }
    throw new Error(`${fallback} (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${fallback} (HTTP ${res.status})`);
  }
}

/** időtúllépés — MÁS, mint a felhasználói megszakítás: ezt szabad újrapróbálni */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`a kérés ${ms} ms alatt nem válaszolt`);
    this.name = 'TimeoutError';
  }
}

/**
 * A projekt egész kliens-rétegében ismétlődő „fetch + saját timeout" minta EGY
 * helyen, újrapróbálkozással. A timeout minden próbálkozásra KÜLÖN indul, és a
 * hívó `signal`-ja is megszakítja (a ✕ gomb végig hatásos marad).
 *
 * Fontos megkülönböztetés: az `AbortController` MINDKÉT okra ugyanazt az
 * `AbortError`-t dobja. A felhasználói megszakítás végleges, az időtúllépés
 * viszont pont az az átmeneti hiba, amiért a retry-réteg létezik — ezért a
 * timeoutot itt saját `TimeoutError`-rá fordítjuk, mielőtt feljebb adnánk.
 */
export async function fetchRead(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const { timeoutMs = 15_000, signal: outer, ...rest } = init;
  return retryRead(async () => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort);
    try {
      return await fetch(url, { ...rest, signal: controller.signal });
    } catch (e) {
      throw timedOut && !outer?.aborted ? new TimeoutError(timeoutMs) : e;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }, { ...opts, signal: outer ?? opts.signal });
}
