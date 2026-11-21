const { logCaught } = require('../lib/caught');
// 🔌 Külső tárhely — az OAuth-folyamat: authorize-URL, kód-csere, callback, token-frissítés.
const { fetchWithTimeout } = require('../netFetch');
const { OAUTH, oauthConfigured } = require('./oauthConfig');
const { signState, verifyState } = require('./signing');
const { saveSourceConfig, upsertProvider } = require('./sourcesDb');

// ───────────────────────────────────────────────────────── OAuth-folyamat
// betöltéskor rögzül (mint a signing.js titka): az Expo Go sémája csak nem-production workeren
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * 🔒 A callback-oldal `location.replace`-célja (returnUrl) allowlistje — validálatlanul `javascript:`
 * / idegen host futna a worker originjén (XSS, open redirect). Engedett: az app deep link-sémája
 * (app.json `scheme: "remix"`, a kliens `Linking.createURL('storage/connected')`-je), a
 * CORS_ORIGINS-ben felsorolt web-originek, dev-ben az Expo Go `exp://` / `exps://` sémája.
 * Minden más → null (a callback-oldal ekkor csak „bezárhatod az ablakot”).
 */
function safeReturnUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u001f\u007f\s\\]/.test(raw)) {
    return null;
  }
  let u;
  try {
    u = new URL(raw);
  } catch (caught) {
    logCaught('userStorage.js:safeReturnUrl', caught);
    return null; // nem abszolút URL (pl. //evil, relatív út) → nem engedett
  }
  if (u.protocol === 'remix:') {
    return raw;
  }
  if ((u.protocol === 'exp:' || u.protocol === 'exps:') && !IS_PROD) {
    return raw;
  }
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    const allowed = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return allowed.includes(u.origin) ? raw : null;
  }
  return null;
}

/** Az authorize-URL, amit a kliens böngészőben megnyit. A `state` aláírva hordja a usert + a redirect_uri-t. */
function oauthStartUrl(uid, provider, redirectBase, returnUrl) {
  const p = OAUTH[provider];
  if (!p) {
    throw new Error(`Ismeretlen OAuth-provider: ${provider}`);
  }
  if (!oauthConfigured(provider)) {
    throw new Error(`A ${p.label} OAuth nincs konfigurálva a workeren (client id/secret).`);
  }
  const redirectUri = `${String(redirectBase).replace(/\/+$/, '')}/storage/oauth/${provider}/callback`;
  const state = signState({ u: uid, r: redirectUri, t: safeReturnUrl(returnUrl), p: provider });
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    ...p.extraAuth,
  });
  return { url: `${p.authUrl}?${params.toString()}`, redirectUri };
}

async function exchangeCode(provider, code, redirectUri) {
  const p = OAUTH[provider];
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    redirect_uri: redirectUri,
  });
  // token-csere: NEM idempotens (nincs retry), de időkorláttal (ne lógjon be)
  const res = await fetchWithTimeout(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:exchangeCode', caught); return {}; });
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token-csere hiba (${res.status})`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

/** Az OAuth-callback feldolgozása: kód → token → DB-sor. Visszaadja a returnUrl-t (deep link). */
async function oauthCallback(provider, code, state) {
  const parsed = verifyState(state);
  if (!parsed || parsed.p !== provider) {
    throw new Error('Érvénytelen OAuth-state.');
  }
  const tokens = await exchangeCode(provider, code, parsed.r);
  await upsertProvider(parsed.u, {
    type: provider,
    label: OAUTH[provider].label,
    config: tokens,
  });
  // a régi (allowlist előtt aláírt) state-ek returnUrl-je is újra-ellenőrizve
  return safeReturnUrl(parsed.t);
}

/** Érvényes access token — lejáratkor frissít és visszaírja a DB-be. */
async function ensureAccessToken(source) {
  const cfg = source.config || {};
  if (cfg.access_token && Number(cfg.expires_at || 0) > Date.now() + 60000) {
    return cfg.access_token;
  }
  const p = OAUTH[source.type];
  if (!p || !cfg.refresh_token) {
    throw new Error('Nincs frissíthető token (újra be kell kötni a forrást).');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refresh_token,
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
  });
  // token-csere: NEM idempotens (nincs retry), de időkorláttal (ne lógjon be)
  const res = await fetchWithTimeout(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:ensureAccessToken', caught); return {}; });
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token-frissítés hiba (${res.status})`);
  }
  const next = {
    ...cfg,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    // Dropbox néha új refresh_tokent ad; ha nem, a régit tartjuk
    refresh_token: data.refresh_token || cfg.refresh_token,
  };
  await saveSourceConfig(source.id, next);
  source.config = next;
  return next.access_token;
}

module.exports = { oauthStartUrl, exchangeCode, oauthCallback, ensureAccessToken, safeReturnUrl };
