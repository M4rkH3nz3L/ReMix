import { logCaught } from '@/lib/logCaught';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 📋 A Supabase nem dob kivételt, `{ error }` mezőt ad vissza, amit sok hívó nem néz meg. Itt, a kérés
 * szintjén minden sikertelen válasz nyomot hagy: az útvonallal, a státusszal és a szerver üzenetével.
 * A lekérdezés-paraméterek kimaradnak, mert azonosítókat tartalmazhatnak.
 */
export function loggedSupabaseFetch(impl: FetchLike): FetchLike {
  return async (input, init) => {
    const res = await impl(input, init);
    if (res.status >= 400) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const body = await res.clone().text().catch((caught: unknown) => {
        logCaught('lib/supabaseFetch.ts', caught);
        return '';
      });
      logCaught(`supabase:${path}`, new Error(`Supabase ${res.status} ${init?.method ?? 'GET'}: ${body.slice(0, 300)}`));
    }
    return res;
  };
}
