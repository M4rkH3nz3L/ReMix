// 🔐 Worker-hitelesítés: Supabase JWT verifikáció + CORS-allowlist.
//
// A worker `service_role` kulccsal ír a Supabase-be, tehát MEGKERÜLI az RLS-t.
// Hitelesítés nélkül ez teljes jogosultság-kiemelkedés: egy `curl`-lel bárki
// ingyen Pro-t/kreditet adhatna magának, beléphetne idegen projektbe, vagy
// push-spamet küldhetne. Ezért a service_role-t használó végpontok mögé
// `requireAuth` kerül, és a hívó azonosítója KIZÁRÓLAG a verifikált tokenből
// jöhet — soha a kérés törzséből.
//
// Env:
//   SUPABASE_URL + SUPABASE_ANON_KEY  → a token-verifikációhoz
//   CORS_ORIGINS                      → vesszővel elválasztott allowlist
//                                       (üres = csak azonos-origin/natív hívás)
//   ALLOW_INSECURE_DEV=1              → ⚠️ CSAK lokális fejlesztéshez: kikapcsolja
//                                       a kötelező hitelesítést. Prod-ban SOHA.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();
const INSECURE_DEV = process.env.ALLOW_INSECURE_DEV === '1';

/** a token-verifikáláshoz elég az anon kulcs (a getUser a tokenből dolgozik) */
let verifier = null;
function verifierClient() {
  if (verifier) {
    return verifier;
  }
  if (!SUPABASE_URL || !ANON_KEY) {
    return null;
  }
  verifier = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return verifier;
}

/** Be van-e kötve a hitelesítés (van-e mivel verifikálni). */
function authAvailable() {
  return verifierClient() !== null;
}

/** `Authorization: Bearer <jwt>` → a nyers token, vagy null. */
function bearerToken(req) {
  const raw = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * A kérés hívójának verifikálása. Sikeres esetben `req.user = { id, email }`.
 * A `userId`-t INNEN kell venni, nem a body-ból.
 */
async function verifyRequest(req) {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Hiányzó Authorization: Bearer <token>.' };
  }
  const client = verifierClient();
  if (!client) {
    return {
      ok: false,
      status: 503,
      error: 'A worker hitelesítése nincs konfigurálva (SUPABASE_URL / SUPABASE_ANON_KEY).',
    };
  }
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) {
      return { ok: false, status: 401, error: 'Érvénytelen vagy lejárt token.' };
    }
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
  } catch (err) {
    return { ok: false, status: 401, error: `Token-verifikáció sikertelen: ${err.message}` };
  }
}

/**
 * Express-middleware: csak hitelesített hívót enged tovább.
 * ⚠️ `ALLOW_INSECURE_DEV=1` esetén átenged, de a hívót `null`-ra állítja és
 * naplóz — így a fejlesztés nem törik meg, a prod viszont védett.
 */
function requireAuth(req, res, next) {
  verifyRequest(req)
    .then((result) => {
      if (result.ok) {
        req.user = result.user;
        next();
        return;
      }
      if (INSECURE_DEV) {
        console.warn(
          `[auth] ⚠️ ALLOW_INSECURE_DEV — hitelesítés nélkül átengedve: ${req.method} ${req.path} (${result.error})`
        );
        req.user = null;
        next();
        return;
      }
      res.status(result.status).json({ error: result.error });
    })
    .catch((err) => res.status(500).json({ error: `Hitelesítési hiba: ${err.message}` }));
}

/**
 * A hívó azonosítója a VERIFIKÁLT tokenből. Insecure-dev módban visszaesik a
 * body-ban küldött értékre (csak így marad használható a lokális fejlesztés).
 */
function callerId(req, bodyFallback) {
  if (req.user?.id) {
    return req.user.id;
  }
  if (INSECURE_DEV) {
    return typeof bodyFallback === 'string' ? bodyFallback : null;
  }
  return null;
}

/**
 * CORS-allowlist middleware a korábbi `Access-Control-Allow-Origin: *` helyett.
 * A natív app nem küld Origin-t (nincs is rá szüksége) — az ilyen kérések
 * érintetlenül mennek. A böngészős dev-előnézethez a CORS_ORIGINS env kell.
 */
function corsAllowlist() {
  const allowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowed.includes(origin) || (INSECURE_DEV && allowed.length === 0))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

module.exports = { authAvailable, requireAuth, verifyRequest, callerId, corsAllowlist, INSECURE_DEV };
