const { logCaught } = require('./lib/caught');
// 🛡️ SSRF-védelem a BYOK (bring-your-own-key) AI-végpontokhoz.
//
// A felhasználó megadhatja a saját AI-szolgáltatója `baseUrl`-jét, és a worker
// ODA küld kérést. Validáció nélkül ez nyílt proxy: a hívó a worker BELSŐ
// hálózatára irányíthatja (felhő-metaadat 169.254.169.254, 10.0.0.0/8,
// localhost:*), a `/ai/probe` pedig a választ visszaadva belső port-szkennerré
// válik.
//
// Védelem (mindkettő kell):
//   1. séma- és HOST-allowlist — csak ismert AI-szolgáltatók, csak https
//   2. DNS-feloldás utáni privát-IP tiltás — a DNS-rebinding és a saját
//      domainre mutató A-rekord ellen
//
// Env: AI_EXTRA_HOSTS=host1,host2  → az allowlist bővítése (saját self-hosted
//      modellhez). ALLOW_INSECURE_DEV=1 → a localhost/http is engedett (Ollama).
const dns = require('dns').promises;
const net = require('net');

const INSECURE_DEV = process.env.ALLOW_INSECURE_DEV === '1';

/** ismert, OpenAI-kompatibilis AI-szolgáltatók (pontos hoszt vagy al-domain) */
const DEFAULT_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.perplexity.ai',
  'generativelanguage.googleapis.com',
  'api.cohere.ai',
  'api.x.ai',
];

function allowedHosts() {
  const extra = (process.env.AI_EXTRA_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_HOSTS, ...extra];
}

/** a hoszt szerepel-e az allowlistán (pontos egyezés vagy al-domain) */
function hostAllowed(hostname) {
  const h = hostname.toLowerCase();
  return allowedHosts().some((a) => h === a || h.endsWith(`.${a}`));
}

/** loopback / privát / link-local / egyedi-lokális cím-e (IPv4 + IPv6) */
function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    return (
      p[0] === 10 || // 10.0.0.0/8
      p[0] === 127 || // loopback
      p[0] === 0 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || // 172.16.0.0/12
      (p[0] === 192 && p[1] === 168) || // 192.168.0.0/16
      (p[0] === 169 && p[1] === 254) || // link-local (felhő-metaadat!)
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || // CGNAT
      p[0] >= 224 // multicast / reserved
    );
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return (
      l === '::' ||
      l === '::1' || // loopback
      l.startsWith('fe80') || // link-local
      l.startsWith('fc') || // unique local
      l.startsWith('fd') ||
      l.startsWith('::ffff:') // IPv4-mapped → a v4 ágon kellene ellenőrizni
    );
  }
  return true; // ismeretlen alak → tiltjuk
}

/**
 * A BYOK `baseUrl` ellenőrzése. Sikeres esetben `{ ok: true, url }`, különben
 * `{ ok: false, error }`. A hívás ELŐTT kell futtatni, és a hibát a felhasználó
 * felé beszédesen visszaadni.
 */
async function assertSafeAiBaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (caught) {
    logCaught('ssrf.js:assertSafeAiBaseUrl', caught);
    return { ok: false, error: 'Érvénytelen AI-cím (URL).' };
  }

  const isLocal =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';

  // 1) séma: csak https (dev-módban a lokális Ollama http-je is mehet)
  if (url.protocol !== 'https:') {
    if (!(INSECURE_DEV && isLocal && url.protocol === 'http:')) {
      return { ok: false, error: 'Az AI-cím csak https lehet.' };
    }
  }

  // dev-mód + localhost → engedjük (lokális modell), DNS-ellenőrzés nélkül
  if (INSECURE_DEV && isLocal) {
    return { ok: true, url };
  }

  // 2) host-allowlist
  if (!hostAllowed(url.hostname)) {
    return {
      ok: false,
      error:
        `A(z) "${url.hostname}" nincs az engedélyezett AI-szolgáltatók listáján. ` +
        'Saját végponthoz állítsd be az AI_EXTRA_HOSTS env-et a workeren.',
    };
  }

  // 3) DNS-feloldás → privát IP tiltása (DNS-rebinding / belső A-rekord ellen)
  try {
    const records = await dns.lookup(url.hostname, { all: true });
    if (records.length === 0) {
      return { ok: false, error: 'Az AI-cím nem feloldható.' };
    }
    const bad = records.find((r) => isPrivateAddress(r.address));
    if (bad) {
      return { ok: false, error: `Az AI-cím belső hálózati címre mutat (${bad.address}).` };
    }
  } catch (err) {
    logCaught('ssrf.js:assertSafeAiBaseUrl', err);
    return { ok: false, error: `Az AI-cím nem feloldható: ${err.message}` };
  }

  return { ok: true, url };
}

/**
 * 🛡️ Általános SSRF-ellenőrzés USER-VEZÉRELT remote URL-ekhez (WebDAV/S3/import).
 *
 * Eltér az AI-úttól: itt NINCS host-allowlist (tetszőleges legitim hoszt kell
 * működjön), ezért a védelem a séma- + a DNS-feloldás-utáni privát-IP-tiltás:
 *   - csak http(s) (prod: csak https; dev + localhost: http is)
 *   - a feloldott IP nem lehet loopback/privát/link-local/metadata (169.254.*)
 *
 * A hálózati hívás ELŐTT futtatandó. Siker: `{ ok:true, url }`, különben
 * `{ ok:false, error }`.
 */
async function assertSafeUrl(rawUrl, { allowHttp = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (caught) {
    logCaught('ssrf.js:assertSafeUrl', caught);
    return { ok: false, error: 'Érvénytelen URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `Nem engedett séma: ${url.protocol} (csak http/https).` };
  }

  const isLocal =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';

  // http csak akkor, ha a hívó explicit engedi, vagy dev + localhost
  if (url.protocol === 'http:' && !allowHttp && !(INSECURE_DEV && isLocal)) {
    return { ok: false, error: 'A cím csak https lehet.' };
  }

  // dev + localhost → engedjük (lokális MinIO/NAS), DNS-ellenőrzés nélkül
  if (INSECURE_DEV && isLocal) {
    return { ok: true, url };
  }

  // DNS-feloldás → privát/metadata IP tiltása (literal IP esetén is helyes:
  // a dns.lookup egy IP-re önmagát adja vissza)
  try {
    const records = await dns.lookup(url.hostname, { all: true });
    if (records.length === 0) {
      return { ok: false, error: 'A cím nem feloldható.' };
    }
    const bad = records.find((r) => isPrivateAddress(r.address));
    if (bad) {
      return { ok: false, error: `A cím belső hálózati címre mutat (${bad.address}).` };
    }
  } catch (err) {
    logCaught('ssrf.js:assertSafeUrl', err);
    return { ok: false, error: `A cím nem feloldható: ${err.message}` };
  }

  return { ok: true, url };
}

/**
 * `assertSafeUrl` + `fetch` egy lépésben. SSRF-blokk esetén DOB (`err.ssrfBlocked`
 * = true), így a hívó 400/502-t adhat. Megjegyzés: a feloldás és a fetch között
 * marad egy szűk DNS-rebinding ablak — allowlist nélküli remote-fetchnél ez az
 * iparági kompromisszum teljes IP-pinning nélkül; a privát-IP-tiltás a támadás
 * 99%-át így is megfogja (metadata/loopback/LAN).
 */
async function safeFetch(rawUrl, init, opts) {
  const check = await assertSafeUrl(rawUrl, opts);
  if (!check.ok) {
    const err = new Error(check.error);
    err.ssrfBlocked = true;
    throw err;
  }
  return fetch(rawUrl, init);
}

/** ennyi átirányítást követünk legfeljebb (a média-CDN-eknek 1–2 elég) */
const MAX_REDIRECTS = 5;

/**
 * 🛡️ `safeFetch` ÁTIRÁNYÍTÁS-KÖVETÉSSEL, minden hop validálva. A sima `fetch` a 3xx-et validálás
 * nélkül követi (`redirect: 'follow'`), így egy nyilvános URL 302-vel belső címre (169.254.169.254,
 * localhost, LAN) vihetné a workert. Itt `redirect: 'manual'`-lal kérünk, és minden `Location`-t
 * ugyanazzal az `assertSafeUrl`-lel ellenőrzünk (séma, https, privát-IP), legfeljebb MAX_REDIRECTS hopig.
 * A 303 — és a POST-os 301/302 — a spec szerint GET-re vált, body nélkül. Blokkolt hop / túl sok
 * átirányítás → DOB (`err.ssrfBlocked = true`), mint a `safeFetch`.
 */
async function safeFetchFollow(rawUrl, init = {}, opts) {
  let url = rawUrl;
  let reqInit = { ...init, redirect: 'manual' };
  for (let hop = 0; ; hop += 1) {
    const res = await safeFetch(url, reqInit, opts);
    const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
    if (!location) {
      return res;
    }
    res.body?.cancel?.().catch((caught) => logCaught('ssrf.js:safeFetchFollow', caught));
    if (hop >= MAX_REDIRECTS) {
      const err = new Error(`Túl sok átirányítás (${MAX_REDIRECTS} felett).`);
      err.ssrfBlocked = true;
      throw err;
    }
    const method = String(reqInit.method || 'GET').toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      reqInit = { ...reqInit, method: 'GET', body: undefined };
    }
    url = new URL(location, url).toString();
  }
}

module.exports = {
  assertSafeAiBaseUrl,
  assertSafeUrl,
  safeFetch,
  safeFetchFollow,
  isPrivateAddress,
  hostAllowed,
};
