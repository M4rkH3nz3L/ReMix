// Provider-elérhetőség: lokális (Ollama) és ReMix AI próba rövid cache-sel, provider-választás.
const { logCaught } = require('../lib/caught');
const { OLLAMA_URL, LOCAL_MODEL, remixAiQueue, remixAiConfig } = require('./config');

/** a lokális runtime elérhetősége — rövid cache-sel, hogy a /health gyors legyen */
let localProbe = { at: 0, ok: false };
async function localAvailable() {
  if (Date.now() - localProbe.at < 30 * 1000) {
    return localProbe.ok;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json();
    const models = (body.models ?? []).map((m) => m.name);
    localProbe = { at: Date.now(), ok: models.some((n) => n.startsWith(LOCAL_MODEL.split(':')[0])) };
  } catch (caught) {
    logCaught('ai.js:localAvailable', caught);
    localProbe = { at: Date.now(), ok: false };
  }
  return localProbe.ok;
}

/** a ReMix AI (Spark) elérhetősége — `GET /models`, rövid cache-sel (a /health gyors marad) */
let remixProbe = { at: 0, ok: false, models: [] };
async function remixAvailable() {
  const cfg = remixAiConfig();
  if (!cfg) {
    return false;
  }
  if (Date.now() - remixProbe.at < 30 * 1000) {
    return remixProbe.ok;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${cfg.baseUrl}/models`, {
      signal: controller.signal,
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    clearTimeout(timer);
    const body = await res.json();
    const models = (body.data ?? []).map((m) => m.id);
    remixProbe = { at: Date.now(), ok: res.ok && models.includes(cfg.model), models };
  } catch (caught) {
    logCaught('ai.js:remixAvailable', caught);
    remixProbe = { at: Date.now(), ok: false, models: [] };
  }
  return remixProbe.ok;
}

/** A ReMix AI állapota (egészség + sor) — a /ai/remix/health végponthoz. */
async function remixStatus() {
  const cfg = remixAiConfig();
  return { configured: !!cfg, healthy: cfg ? await remixAvailable() : false, model: cfg ? cfg.model : null, queue: remixAiQueue.stats() };
}

async function aiProvider() {
  if (await remixAvailable()) {
    return 'remix';
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }
  if (await localAvailable()) {
    return 'local';
  }
  return null;
}

async function aiAvailable() {
  return (await aiProvider()) !== null;
}

module.exports = { localAvailable, remixAvailable, remixStatus, aiProvider, aiAvailable };
