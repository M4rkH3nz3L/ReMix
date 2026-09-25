/**
 * 🔧 DEV↔PROD config-guardok — TISZTA függvények (nincs `__DEV__` global és nincs
 * `process.env` beolvasás itt; a hívó adja át `isDev`-et és a nyers env-értéket).
 *
 * FŐ VONAL: a DEV és a PROD UGYANAZ a kód — csak az env dönt. Ezek a guardok
 * biztosítják, hogy az ÉLES (nem-`__DEV__`) build:
 *   • soha ne fusson LOKÁLIS (loopback) backend-címmel (az a telepített appban a
 *     saját készüléket jelentené, nem a szervert), és
 *   • ne menjen TITKOSÍTATLAN HTTP-n (a worker felé token/kulcs/média utazik).
 *
 * Külön, expo-mentes modul → önmagában unit-tesztelhető (lásd `envConfig.test.ts`).
 * A `supabase.ts` és a `backend.ts` ezt használja (nincs duplikált loopback-logika).
 */

/** Loopback (a saját készülék) hoszt? — 127.0.0.1 / localhost / 0.0.0.0 / ::1. */
export function isLoopbackHost(u: string | undefined | null): boolean {
  if (!u) {
    return false;
  }
  try {
    // IPv6 zárójelek le (`[::1]` → `::1`)
    const h = new URL(u).hostname.replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0' || h === '::1';
  } catch {
    return false;
  }
}

/**
 * Publikus (Supabase) URL feloldása a dev↔prod szabály szerint:
 *   • PROD (isDev=false) + loopback cím        → `undefined` (hibás konfig →
 *     „nincs konfigurálva"; a hívó beszédes login-hibát ad, nem néma összeomlás)
 *   • DEV + loopback + VALÓDI (nem-loopback) metró-hoszt → a metró LAN-IP-jére
 *     átírva (így fizikai eszközön is eléri a dev-gépet)
 *   • egyébként                                 → a trimmelt nyers URL
 */
export function resolvePublicUrl(opts: {
  raw: string | undefined | null;
  isDev: boolean;
  metroHost?: string;
}): string | undefined {
  const raw = opts.raw?.trim();
  if (!raw) {
    return undefined;
  }
  // prod + loopback → nincs érvényes config
  if (!opts.isDev && isLoopbackHost(raw)) {
    return undefined;
  }
  try {
    const u = new URL(raw);
    const m = opts.metroHost;
    if (isLoopbackHost(raw) && m && m !== '127.0.0.1' && m !== 'localhost') {
      u.hostname = m;
      return u.toString().replace(/\/$/, '');
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Biztonságos-e az URL RELEASE buildben? DEV-ben minden mehet (helyi worker);
 * PRODban csak `https://` ÉS nem-loopback (az iOS ATS / Android NSC amúgy is
 * blokkolná a sima http-t). A `backend.ts` ezzel tiltja a titkosítatlan/lokális
 * worker-hívást éles buildben.
 */
export function isSecureForRelease(url: string, isDev: boolean): boolean {
  if (isDev) {
    return true;
  }
  return url.startsWith('https://') && !isLoopbackHost(url);
}
