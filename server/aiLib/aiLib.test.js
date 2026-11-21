// 🤖 A server/aiLib/ modulcsalád regressziós tesztjei (REFACTOR): a server/ai.js bontása után a
// BYOK-config szűrés, a provider-próba (SSRF-őr, fejlécek), a provider-választás, az aiTokens-mérés
// (env Anthropic + ReMix AI mért; BYOK és lokális nem) és a hívás-hibák JELENLEGI viselkedését rögzítik.
// Az Anthropic SDK, az SSRF-őr, a usage-modul és a fetch mockolva.
const { z } = require('zod');

const mockState = { anthropic: [], parseReply: null, tracked: [], store: null, ssrf: [], caught: [] };

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation((opts) => {
    mockState.anthropic.push(opts);
    return { messages: { parse: async (args) => (mockState.anthropic.push(args), mockState.parseReply) } };
  })
);
jest.mock('../ssrf', () => ({
  assertSafeAiBaseUrl: async (url) => {
    mockState.ssrf.push(url);
    return /api\.openai\.com|api\.anthropic\.com/.test(url) && url.startsWith('https://')
      ? { ok: true }
      : { ok: false, error: 'tiltott cím' };
  },
}));
jest.mock('../usage', () => ({
  ...jest.requireActual('../usage'),
  trackUsage: async (...a) => mockState.tracked.push(a),
  aiUsageContext: { getStore: () => mockState.store },
}));
jest.mock('../lib/caught', () => ({ logCaught: (tag, err) => mockState.caught.push([tag, err && err.message]) }));

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'REMIX_AI_URL', 'REMIX_AI_MODEL', 'REMIX_AI_KEY', 'LOCAL_AI_MODEL', 'OLLAMA_URL', 'AI_MODEL'];
let fetchCalls;
let fetchImpl;

function load(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  jest.resetModules();
  return require('../ai');
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  Object.assign(mockState, { anthropic: [], parseReply: null, tracked: [], store: null, ssrf: [], caught: [] });
  fetchCalls = [];
  fetchImpl = async () => json(404, {});
  global.fetch = jest.fn(async (url, init) => (fetchCalls.push([url, init]), fetchImpl(url, init)));
});

const schema = z.object({ ok: z.boolean() });

describe('sanitizeAiConfig', () => {
  const { sanitizeAiConfig } = require('./byok');
  test('nem-objektum vagy modell nélküli config → null', () => {
    expect(sanitizeAiConfig(null)).toBeNull();
    expect(sanitizeAiConfig('x')).toBeNull();
    expect(sanitizeAiConfig({ provider: 'openai', model: '   ', baseUrl: 'https://api.openai.com' })).toBeNull();
  });
  test('nem-anthropic providerhez base_url kell; az ismeretlen provider custom lesz', () => {
    expect(sanitizeAiConfig({ provider: 'openai', model: 'm' })).toBeNull();
    expect(sanitizeAiConfig({ provider: 'EVIL', model: 'm', baseUrl: 'https://x' })).toEqual({ provider: 'custom', model: 'm', baseUrl: 'https://x', apiKey: '' });
  });
  test('anthropic base_url nélkül is elfogadott; a mezők trimmelve, a nem-string mezők üresek', () => {
    expect(sanitizeAiConfig({ provider: 'anthropic', model: ' c ', apiKey: ' k ' })).toEqual({ provider: 'anthropic', model: 'c', baseUrl: '', apiKey: 'k' });
    expect(sanitizeAiConfig({ provider: 'anthropic', model: 'c', baseUrl: 5, apiKey: {} })).toEqual({ provider: 'anthropic', model: 'c', baseUrl: '', apiKey: '' });
  });
});

describe('probeProvider', () => {
  test('anthropic alap-címe, x-api-key + verzió fejléc, redirect: error', async () => {
    const ai = load();
    fetchImpl = async () => json(200, {});
    await expect(ai.probeProvider({ provider: 'anthropic', apiKey: 'k1' })).resolves.toBe(true);
    expect(fetchCalls[0][0]).toBe('https://api.anthropic.com/v1/models');
    expect(fetchCalls[0][1].headers).toEqual({ 'x-api-key': 'k1', 'anthropic-version': '2023-06-01' });
    expect(fetchCalls[0][1].redirect).toBe('error');
  });
  test('tiltott (SSRF) cím → false, fetch nélkül; üres cím → false', async () => {
    const ai = load();
    await expect(ai.probeProvider({ provider: 'openai', baseUrl: 'http://169.254.169.254/' })).resolves.toBe(false);
    await expect(ai.probeProvider({ provider: 'openai', baseUrl: '' })).resolves.toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });
  test('OpenAI: Bearer fejléc, a záró perjelek levágva; hálózati hiba → false + logCaught', async () => {
    const ai = load();
    fetchImpl = async () => {
      throw new Error('le');
    };
    await expect(ai.probeProvider({ provider: 'openai', baseUrl: 'https://api.openai.com/v1//', apiKey: 'k2' })).resolves.toBe(false);
    expect(fetchCalls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(fetchCalls[0][1].headers).toEqual({ authorization: 'Bearer k2' });
    expect(mockState.caught).toEqual([['ai.js:probeProvider', 'le']]);
  });
});

describe('provider-választás', () => {
  test('ReMix AI előbb, ha a próba látja a modellt; különben env Anthropic', async () => {
    let ai = load({ REMIX_AI_URL: ' https://spark/v1/ ', REMIX_AI_MODEL: 'r', ANTHROPIC_API_KEY: 'x' });
    fetchImpl = async () => json(200, { data: [{ id: 'r' }] });
    await expect(ai.aiProvider()).resolves.toBe('remix');
    expect(fetchCalls[0][0]).toBe('https://spark/v1/models');
    ai = load({ REMIX_AI_URL: 'https://spark/v1', REMIX_AI_MODEL: 'r', ANTHROPIC_API_KEY: 'x' });
    fetchImpl = async () => json(200, { data: [{ id: 'mas' }] });
    await expect(ai.aiProvider()).resolves.toBe('anthropic');
  });
  test('kulcs és Ollama nélkül nincs provider; a hiba-üzenet a LOCAL_MODEL-t nevezi meg', async () => {
    const ai = load({ LOCAL_AI_MODEL: 'llama3:8b' });
    fetchImpl = async () => json(200, { models: [{ name: 'mistral' }] });
    await expect(ai.aiAvailable()).resolves.toBe(false);
    await expect(ai.runStructured('s', 'u', schema)).rejects.toThrow('ollama pull llama3:8b');
    expect(ai.LOCAL_MODEL).toBe('llama3:8b');
  });
  test('remixStatus: konfigurálatlan ReMix AI → configured false, a sor statisztikája', async () => {
    const ai = load();
    await expect(ai.remixStatus()).resolves.toEqual({ configured: false, healthy: false, model: null, queue: { active: 0, waiting: 0, concurrency: 4, maxQueue: 32, avgMs: 8000 } });
  });
});

describe('aiTokens-mérés', () => {
  test('env Anthropic: mért, a hívó uid-jére; az env-kliens kulcs nélkül épül', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'env', AI_MODEL: 'm-env' });
    mockState.store = { uid: 'u1', tier: 'pro' };
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: { ok: true }, usage: { input_tokens: 10, output_tokens: 5 } };
    await expect(ai.runStructured('s', 'u', schema)).resolves.toEqual({ ok: true });
    expect(mockState.anthropic[0]).toBeUndefined();
    expect(mockState.anthropic[1]).toMatchObject({ model: 'm-env', max_tokens: 16000, thinking: { type: 'adaptive' }, system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(mockState.tracked).toEqual([['u1', 'aiTokens', 15]]);
  });
  test('üres uid vagy 0 token → nincs mérés', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'env' });
    mockState.store = { uid: '', tier: 'free' };
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: { ok: true }, usage: { input_tokens: 10, output_tokens: 5 } };
    await ai.runStructured('s', 'u', schema);
    mockState.store = { uid: 'u1' };
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: { ok: true } };
    await ai.runStructured('s', 'u', schema);
    expect(mockState.tracked).toEqual([]);
  });
  test('BYOK Anthropic: a felhasználó kulcsa és modellje, NEM mért', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'env' });
    mockState.store = { uid: 'u1', tier: 'pro' };
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: { ok: true }, usage: { input_tokens: 10, output_tokens: 5 } };
    await ai.runStructured('s', 'u', schema, { provider: 'anthropic', model: 'mine', baseUrl: '', apiKey: 'user-key' });
    expect(mockState.anthropic[0]).toEqual({ apiKey: 'user-key' });
    expect(mockState.anthropic[1].model).toBe('mine');
    expect(mockState.tracked).toEqual([]);
  });
  test('lokális Ollama: think: false a qwen3-nál, NEM mért', async () => {
    const ai = load();
    mockState.store = { uid: 'u1', tier: 'pro' };
    fetchImpl = async (url) =>
      url.endsWith('/api/tags')
        ? json(200, { models: [{ name: 'qwen3:14b' }] })
        : json(200, { message: { content: '{"ok":true}' }, prompt_eval_count: 3, eval_count: 4 });
    await expect(ai.runStructured('s', 'u', schema)).resolves.toEqual({ ok: true });
    const body = JSON.parse(fetchCalls[1][1].body);
    expect(fetchCalls[1][0]).toBe('http://127.0.0.1:11434/api/chat');
    expect(body).toMatchObject({ model: 'qwen3:14b', stream: false, think: false, options: { temperature: 0.2, num_ctx: 16384 } });
    expect(mockState.tracked).toEqual([]);
  });
});

describe('OpenAI-kompatibilis BYOK-hívás', () => {
  const cfg = { provider: 'openai', model: 'gpt', baseUrl: 'https://api.openai.com/v1/', apiKey: 'k' };
  test('SSRF-tiltott cím → a hiba-üzenet, fetch nélkül', async () => {
    const ai = load();
    await expect(ai.runStructured('s', 'u', schema, { ...cfg, baseUrl: 'https://10.0.0.1/v1' })).rejects.toThrow('tiltott cím');
    expect(fetchCalls).toHaveLength(0);
  });
  test('a séma a system-be kerül, json_object mód, redirect: error; NEM mért', async () => {
    const ai = load();
    mockState.store = { uid: 'u1', tier: 'pro' };
    fetchImpl = async () => json(200, { choices: [{ message: { content: '{"ok":false}' } }], usage: { total_tokens: 9 } });
    await expect(ai.runStructured('S', 'U', schema, cfg)).resolves.toEqual({ ok: false });
    const [url, init] = fetchCalls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer k' });
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content.startsWith('S\n\nVÁLASZ: kizárólag EGYETLEN JSON-objektum')).toBe(true);
    expect(mockState.tracked).toEqual([]);
  });
  test('hiba-ágak: HTTP-hiba (300 karakterre vágva), érvénytelen JSON, séma-eltérés', async () => {
    const ai = load();
    fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'E'.repeat(400) });
    await expect(ai.runStructured('s', 'u', schema, cfg)).rejects.toThrow(`AI hiba (500): ${'E'.repeat(300)}`);
    fetchImpl = async () => json(200, { choices: [{ message: { content: 'nem json' } }] });
    await expect(ai.runStructured('s', 'u', schema, cfg)).rejects.toThrow('Az AI válasza nem volt érvényes JSON.');
    fetchImpl = async () => json(200, { choices: [{ message: { content: '{"ok":"igen"}' } }] });
    await expect(ai.runStructured('s', 'u', schema, cfg)).rejects.toThrow('Az AI válasza nem felelt meg a sémának.');
  });
});

describe('funkció-promptok', () => {
  test('fordítás: a célnyelv és a szegmensek a user-üzenetben', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'env' });
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: { segments: [] } };
    await ai.runTranslateCaptions([{ id: 'c1', text: 'szia' }], 'English');
    expect(mockState.anthropic[1].messages[0].content).toBe('CÉLNYELV: English\n\nSZEGMENSEK:\n[\n {\n  "id": "c1",\n  "text": "szia"\n }\n]');
    expect(mockState.anthropic[1].system.startsWith('Feliratszövegeket fordítasz')).toBe(true);
  });
  test('elutasítás és értelmezhetetlen válasz → magyar hiba-üzenet', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'env' });
    mockState.parseReply = { stop_reason: 'refusal', parsed_output: { headlines: [] } };
    await expect(ai.runThumbHeadlines('t')).rejects.toThrow('A modell elutasította a kérést.');
    mockState.parseReply = { stop_reason: 'end_turn', parsed_output: null };
    await expect(ai.runHookGenerator('t')).rejects.toThrow('A modell válasza nem volt értelmezhető.');
  });
});
