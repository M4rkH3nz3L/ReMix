/**
 * 🧯 Kétrétegű hibakezelés MAGja (expo-mentes → tesztelhető).
 *
 * A cél: a felhasználó SOHA ne lásson nyers stacktrace-t vagy „TypeError: …"
 * üzenetet. Minden hibát besorolunk egy FAJTÁRA (`ErrorKind`), amiből a UI egy
 * barátságos, cselekvésre hívó üzenetet fordít (i18n `errors.<kind>`), míg a
 * technikai RÉSZLET (a fejlesztői réteg) a logba kerül.
 *
 * Használat a hívóknál:
 *   catch (e) {
 *     const err = toAppError(e);
 *     console.warn('export hiba:', err.detail);   // fejlesztői réteg
 *     Alert.alert(t('errors.title'), t('errors.' + err.kind)); // felhasználói réteg
 *   }
 */

export type ErrorKind = 'network' | 'auth' | 'forbidden' | 'notFound' | 'server' | 'unknown';

export interface AppError {
  kind: ErrorKind;
  /** a nyers, fejlesztőnek szánt részlet (logba, nem a felhasználónak) */
  detail: string;
}

/** Nyers, fejlesztői részlet kinyerése bármilyen dobott értékből. */
export function errorDetail(e: unknown): string {
  if (e == null) {
    return '';
  }
  if (typeof e === 'string') {
    return e;
  }
  if (e instanceof Error) {
    return e.message || e.name;
  }
  if (typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Hiba besorolása fajtára a részlet-szöveg (és gyakori HTTP-státusz) alapján.
 * Szándékosan robusztus a részlet-egyezésre (magyar és angol kulcsszavak is),
 * hogy a worker/Supabase/hálózati hibák is a helyes fajtába essenek.
 */
export function classifyError(e: unknown): ErrorKind {
  const s = errorDetail(e).toLowerCase();
  if (!s) {
    return 'unknown';
  }
  if (
    /(network request failed|failed to fetch|network error|timeout|timed out|abort|offline|econnrefused|enotfound|nincs kapcsolat|hálózat)/.test(
      s
    )
  ) {
    return 'network';
  }
  // 403 / jogosultság-hiány KÜLÖN a 401-től: a felhasználó BE VAN jelentkezve,
  // csak nincs joga — a „jelentkezz be újra" itt félrevezető lenne.
  if (/(\b403\b|forbidden|permission denied|jogosultság|nincs jogod|not allowed)/.test(s)) {
    return 'forbidden';
  }
  if (/(\b401\b|unauthorized|bearer|jwt|not authenticated|hitelesít)/.test(s)) {
    return 'auth';
  }
  if (/(\b404\b|not found|nincs ilyen|nem található)/.test(s)) {
    return 'notFound';
  }
  if (/(\b500\b|\b502\b|\b503\b|\b504\b|server error|internal error|szerver)/.test(s)) {
    return 'server';
  }
  return 'unknown';
}

/** Egy lépésben: fajta + nyers részlet. */
export function toAppError(e: unknown): AppError {
  return { kind: classifyError(e), detail: errorDetail(e) };
}
