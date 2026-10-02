import { supabase } from '@/lib/supabase';

/**
 * 🔐 Hitelesítés a felhő-worker felé.
 *
 * A worker `service_role` kulccsal ír a Supabase-be (megkerüli az RLS-t), ezért
 * a fizetési/kredit/meghívó/értesítő végpontjai Supabase-JWT-t követelnek, és a
 * hívó azonosítóját KIZÁRÓLAG a tokenből veszik — nem a kérés törzséből. Enélkül
 * ezek a hívások 401-et kapnak (kivéve a worker `ALLOW_INSECURE_DEV` módját).
 *
 * A tokent minden híváskor frissen kérjük le: a Supabase-kliens magától frissíti
 * lejáratkor, így mindig érvényeset kapunk.
 */
export async function workerAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) {
    return {};
  }
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // best-effort: token nélkül megy a kérés, a worker majd 401-et ad
    return {};
  }
}

/** JSON-hívás a workerhez, a bejelentkezett felhasználó tokenjével. */
export async function workerJsonHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', ...(await workerAuthHeaders()) };
}

/**
 * 🔐 A NYERS access-token (fejléc nélkül). Oda kell, ahol nem lehet fejlécet
 * küldeni, de a hívás hitelesítése kötelező — pl. a kész render MP4 URL-je
 * (`/render/:id/file`), amit a böngésző / `uploadMedia` közvetlenül FETCH-el: ott
 * a token `?t=` query-paraméterként megy (render-BOLA, devs/tasks/remix/07).
 * Üres string, ha nincs munkamenet.
 */
export async function workerAuthToken(): Promise<string> {
  if (!supabase) {
    return '';
  }
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  } catch {
    return '';
  }
}
