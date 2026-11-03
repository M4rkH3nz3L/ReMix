// 🧠 ReMix AI (Spark) provider (C5.3) — egy lokális, OpenAI-kompatibilis próbaszerverrel (a vLLM /
// SGLang ugyanezt az API-t adja): egészség-próba, strukturált válasz, tokenmérés a mi költségünkként,
// prioritásos sor és túlterhelés.
const http = require('http');
const { z } = require('zod');

let mockDelayMs = 0;
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'remix-test-20b' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      const parsed = JSON.parse(body);
      seen.push({ auth: req.headers.authorization, model: parsed.model });
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true, echo: parsed.messages[1].content }) } }], usage: { total_tokens: 1234 } }));
      }, mockDelayMs);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
});

const tracked = [];
jest.mock('./usage', () => {
  const real = jest.requireActual('./usage');
  return { ...real, trackUsage: async (...a) => { tracked.push(a); } };
});

let ai;
let usage;
beforeAll(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.REMIX_AI_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.REMIX_AI_MODEL = 'remix-test-20b';
  process.env.REMIX_AI_KEY = 'belso-kulcs';
  process.env.REMIX_AI_MAX_CONCURRENCY = '1';
  process.env.REMIX_AI_QUEUE_MAX = '1';
  delete process.env.ANTHROPIC_API_KEY;
  ai = require('./ai');
  usage = require('./usage');
});
afterAll(() => new Promise((r) => server.close(r)));

const schema = z.object({ ok: z.boolean(), echo: z.string() });

test('a ReMix AI az elsődleges provider, ha a próba látja a modellt', async () => {
  await expect(ai.aiProvider()).resolves.toBe('remix');
  await expect(ai.remixStatus()).resolves.toMatchObject({ configured: true, healthy: true, model: 'remix-test-20b' });
});

test('strukturált válasz a belső kulccsal; a tokeneket a hívó kvótájába mérjük', async () => {
  tracked.length = 0;
  const out = await usage.aiUsageContext.run({ uid: 'u1', tier: 'pro' }, () => ai.runStructured('rendszer', 'szia', schema));
  expect(out).toEqual({ ok: true, echo: 'szia' });
  expect(seen.at(-1)).toEqual({ auth: 'Bearer belso-kulcs', model: 'remix-test-20b' });
  expect(tracked).toEqual([['u1', 'aiTokens', 1234]]);
});

test('egy gép = véges kapacitás: tele sornál 503 ai_overloaded, kerülőúttal', async () => {
  mockDelayMs = 150;
  const run = () => usage.aiUsageContext.run({ uid: 'u2', tier: 'basic' }, () => ai.runStructured('s', 'x', schema));
  const a = run(); // fut
  const b = run(); // sorban (max 1)
  await new Promise((r) => setTimeout(r, 20));
  await expect(run()).rejects.toMatchObject({ message: 'ai_overloaded', status: 503, payload: { fallback: ['on_device', 'byok'] } });
  await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  mockDelayMs = 0;
});

test('a ReMix AI kiesése: a próba nem látja → nincs ReMix provider (a lokális/BYOK út marad)', async () => {
  const prev = process.env.REMIX_AI_MODEL;
  process.env.REMIX_AI_MODEL = 'nem-letezo-modell';
  jest.resetModules();
  const fresh = require('./ai');
  await expect(fresh.remixStatus()).resolves.toMatchObject({ healthy: false });
  await expect(fresh.aiProvider()).resolves.not.toBe('remix');
  process.env.REMIX_AI_MODEL = prev;
});
