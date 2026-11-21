// Provider-hívások: env/BYOK Anthropic, lokális Ollama, OpenAI-kompatibilis (BYOK SSRF-őrrel + ReMix AI).
const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const { assertSafeAiBaseUrl } = require('../ssrf');
const { aiTokenCount } = require('../usage');
const { MODEL, OLLAMA_URL, LOCAL_MODEL } = require('./config');

async function runAnthropic(system, userContent, schema, cfg) {
  // BYOK: a felhasználó kulcsa/modellje, ha küldött; különben (cfg nélkül) az env-alapértelmezés.
  // 🔒 BYOK-config kulcs nélkül SOHA nem eshet az env-kliensre: a BYOK-út nem mért → a MI kulcsunk
  // mérés és kvóta nélkül futna (a sanitizeAiConfig már kiszűri; ez a mélységi védelem).
  if (cfg && !(typeof cfg.apiKey === 'string' && cfg.apiKey.trim())) {
    throw new Error('BYOK Anthropic-hívás API-kulcs nélkül — a saját kulcsodat add meg a profilodban.');
  }
  const client = cfg ? new Anthropic({ apiKey: cfg.apiKey }) : new Anthropic();
  const response = await client.messages.parse({
    model: (cfg && cfg.model) || MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: userContent }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('A modell elutasította a kérést.');
  }
  if (!response.parsed_output) {
    throw new Error('A modell válasza nem volt értelmezhető.');
  }
  return { data: response.parsed_output, tokens: aiTokenCount(response) };
}

async function runLocal(system, userContent, schema) {
  const body = {
    model: LOCAL_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    // kényszerített JSON-séma kimenet (Ollama structured outputs)
    format: z.toJSONSchema(schema),
    options: { temperature: 0.2, num_ctx: 16384 },
  };
  // a gondolkodó modellek (qwen3/deepseek-r1) direktben válaszoljanak —
  // a strukturált kimenethez a thinking csak latenciát adna
  if (/^(qwen3|deepseek-r1|magistral)/.test(LOCAL_MODEL)) {
    body.think = false;
  }
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Lokális AI hiba (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const reply = await res.json();
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(reply.message?.content ?? ''));
  } catch {
    throw new Error('A lokális modell válasza nem volt érvényes JSON.');
  }
  if (!parsed.success) {
    throw new Error('A lokális modell válasza nem felelt meg a sémának.');
  }
  return { data: parsed.data, tokens: aiTokenCount(reply) };
}

/**
 * OpenAI-kompatibilis strukturált hívás (OpenAI / Ollama /v1 / bármely
 * kompatibilis végpont). A JSON-sémát a system-be tesszük, `json_object`
 * módban kérünk, majd zod-dal validálunk — ez a legszélesebb körben támogatott.
 */
async function runOpenAICompatible(system, userContent, schema, cfg) {
  // 🛡️ SSRF: a baseUrl a FELHASZNÁLÓTÓL jön → allowlist + privát-IP tiltás a
  // hívás ELŐTT (enélkül a worker belső hálózati címekre kényszeríthető)
  const safe = await assertSafeAiBaseUrl(cfg.baseUrl);
  if (!safe.ok) {
    throw new Error(safe.error);
  }
  return openAiCompatCall(system, userContent, schema, cfg);
}

/** Az OpenAI-kompatibilis hívás magja — a BYOK-út (SSRF-ellenőrzés után) és a ReMix AI (env) közös része. */
async function openAiCompatCall(system, userContent, schema, cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const sys =
    `${system}\n\nVÁLASZ: kizárólag EGYETLEN JSON-objektum, ami megfelel ennek a ` +
    `JSON-sémának (más szöveg, magyarázat vagy kódblokk NÉLKÜL):\n${JSON.stringify(z.toJSONSchema(schema))}`;
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    // 🛡️ a redirect-követés megkerülné az allowlistet (a 302 bárhová vihetne)
    redirect: 'error',
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(`AI hiba (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  let obj;
  try {
    obj = JSON.parse(content);
  } catch {
    throw new Error('Az AI válasza nem volt érvényes JSON.');
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new Error('Az AI válasza nem felelt meg a sémának.');
  }
  return { data: parsed.data, tokens: aiTokenCount(data) };
}

module.exports = { runAnthropic, runLocal, runOpenAICompatible, openAiCompatCall };
