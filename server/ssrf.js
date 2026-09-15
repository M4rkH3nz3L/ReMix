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
  } catch {
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
    return { ok: false, error: `Az AI-cím nem feloldható: ${err.message}` };
  }

  return { ok: true, url };
}

module.exports = { assertSafeAiBaseUrl, isPrivateAddress, hostAllowed };
