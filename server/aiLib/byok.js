// BYOK (saját AI-kulcs/végpont): a kliens-config szűrése és a provider-elérhetőségi próba (SSRF-őrrel).
const { logCaught } = require('../lib/caught');
const { assertSafeAiBaseUrl } = require('../ssrf');

/**
 * A klienstől érkező BYOK-config ellenőrzése. Csak akkor fogadjuk el, ha van
 * modell; a nem-anthropic providerekhez base_url is kell (oda megy a hívás).
 * Érvénytelen → null → a worker a saját (env) AI-jára esik vissza.
 *
 * ⚠️ A base_url a felhasználótól jön → a worker oda POST-ol (BYOK: saját kulcs,
 *    saját végpont). Prod-ban érdemes a providereket allowlistázni (SSRF).
 */
function sanitizeAiConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const provider = ['openai', 'anthropic', 'ollama', 'custom'].includes(raw.provider)
    ? raw.provider
    : 'custom';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (!model) {
    return null;
  }
  if (provider !== 'anthropic' && !baseUrl) {
    return null;
  }
  return { provider, model, baseUrl, apiKey };
}

// --- 🟢 Provider-health próba: elérhető-e a modell végpontja ----------------

/**
 * Gyors reachability-próba egy BYOK-providerhez: GET {baseUrl}/models (OpenAI-
 * kompatibilis + Ollama + Anthropic mind ad modell-listát). 2xx = elérhető.
 * Rövid időkorlát; hálózati hiba / időtúllépés = nem elérhető.
 */
async function probeProvider(cfg) {
  const isAnthropic = cfg.provider === 'anthropic';
  const base = (cfg.baseUrl || (isAnthropic ? 'https://api.anthropic.com/v1' : '')).replace(/\/+$/, '');
  if (!base) {
    return false;
  }
  // 🛡️ SSRF: ez a végpont a találatot VISSZAADJA a hívónak, ezért ellenőrzés
  // nélkül belső port-szkennerként lenne használható (169.254.169.254, 10/8,
  // localhost:*). Nem-engedélyezett cél → egyszerűen „nem elérhető".
  const safe = await assertSafeAiBaseUrl(base);
  if (!safe.ok) {
    return false;
  }
  const headers = {};
  if (isAnthropic) {
    if (cfg.apiKey) {
      headers['x-api-key'] = cfg.apiKey;
    }
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${base}/models`, { headers, redirect: 'error', signal: controller.signal });
    return res.ok;
  } catch (caught) {
    logCaught('ai.js:probeProvider', caught);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sanitizeAiConfig, probeProvider };
