/**
 * 🌐 Szerveren tárolt média (renderelt videó / borító / avatar) URL-jének a
 * kliens által ELÉRHETŐ hostra igazítása (expo-mentes → tesztelhető).
 *
 * MIÉRT: dev-ben a worker a Supabase Storage `127.0.0.1:54421`-es publikus
 * URL-jét menti a poszthoz. Ezt a fizikai eszköz NEM éri el (a 127.0.0.1 magát a
 * telefont jelenti), ezért a feed némán nem játszik le videót. A storage
 * ugyanazon a hoszton:porton szolgál, mint a Supabase API, így a stored URL
 * originjét a kliens ismert, elérhető Supabase-originjére (EXPO_PUBLIC_SUPABASE_URL)
 * cseréljük. Élesben (valódi felhő-URL) nincs mit átírni — a regex nem talál.
 */

/** A kliens által elérhető Supabase-origin (scheme://host[:port]) vagy null. */
function supabaseOrigin(): string | null {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) {
    return null;
  }
  const m = /^(https?:\/\/[^/]+)/.exec(raw);
  return m ? m[1] : null;
}

/** Loopback-originek, amiket egy fizikai eszköz nem ér el. */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i;

/**
 * A média-URL loopback-originjét a kliens elérhető Supabase-originjére írja.
 * `null`/üres → változatlanul visszaadja; nem-loopback (éles) URL → érintetlen.
 */
export function reachableMediaUrl(url: string | null | undefined): string | null {
  if (!url) {
    // null / undefined / üres → „nincs média"
    return null;
  }
  if (!LOOPBACK.test(url)) {
    return url;
  }
  const origin = supabaseOrigin();
  if (!origin) {
    return url;
  }
  return url.replace(LOOPBACK, origin);
}
