// AI-réteg konfiguráció: modellnevek, lokális (Ollama) cím, ReMix AI (Spark) config + prioritásos sor.
// Az env-et betöltéskor olvassa (mint eddig a server/ai.js).
const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

// Lokális AI (dev): Ollama a fejlesztő gépen — ANTHROPIC_API_KEY nélkül ez fut.
// A modell szándékosan könnyen cserélhető (LOCAL_AI_MODEL env); az alap a
// qwen3:14b (jó minőség/sebesség M1 Max + 64 GB-on, strukturált kimenettel).
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL || 'qwen3:14b';

// 🧠 Saját AI — „ReMix AI” (PRO-CASH 7., C5.3): a DGX Sparkon futó OpenAI-kompatibilis szerver
// (vLLM / SGLang), privát hálózaton (WireGuard / Tailscale). A fizetős szintek ezt kapják, a mi
// költségünkként mérve (aiTokens kvóta); a Free a telefonos modellt / saját kulcsot használja.
// A gép véges kapacitás → prioritásos sor (server/aiQueue.js), túltelítéskor 503 + kerülőút.
const { createAiQueue } = require('../aiQueue');
const remixAiQueue = createAiQueue({
  concurrency: Math.max(1, Number(process.env.REMIX_AI_MAX_CONCURRENCY) || 4),
  maxQueue: Math.max(0, Number(process.env.REMIX_AI_QUEUE_MAX) || 32),
});
function remixAiConfig() {
  const url = (process.env.REMIX_AI_URL || '').trim().replace(/\/+$/, '');
  return url ? { baseUrl: url, model: process.env.REMIX_AI_MODEL || 'remix-default', apiKey: process.env.REMIX_AI_KEY || '' } : null;
}

module.exports = { MODEL, OLLAMA_URL, LOCAL_MODEL, remixAiQueue, remixAiConfig };
