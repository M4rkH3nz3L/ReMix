// 🔒 aiMeter — a kulcs nélküli „BYOK” config NEM kerülheti meg az AI-token kvótát (env-Anthropic = a MI költségünk).
const mockState = { quota: [], tier: [] };
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));
jest.mock('../billing', () => ({ isPro: async () => false, isPaid: async () => false }));
jest.mock('../usage', () => ({
  enforceQuota: async (uid, tier, metric, n) => (mockState.quota.push([uid, tier, metric, n]), { ok: true, remaining: 99 }),
  userTier: async (uid) => (mockState.tier.push(uid), 'free'),
  aiUsageContext: { run: (_store, fn) => fn() },
}));
jest.mock('../ai', () => ({
  aiProvider: async () => 'anthropic',
  sanitizeAiConfig: jest.requireActual('../aiLib/byok').sanitizeAiConfig,
}));

const { aiMeter } = require('./guards');

function run(aiConfig) {
  return new Promise((resolve) => {
    const req = { user: { id: 'u1' }, body: { aiConfig } };
    const res = { status: () => ({ json: (b) => resolve({ blocked: b }) }) };
    aiMeter(req, res, () => resolve({ next: true }));
  });
}

beforeEach(() => {
  mockState.quota = [];
  mockState.tier = [];
});

describe('aiMeter — BYOK csak valódi kulccsal', () => {
  test('támadás: kulcs nélküli anthropic „BYOK” → a kvóta-gate LEFUT (enforceQuota a hívó uid-jára)', async () => {
    await expect(run({ provider: 'anthropic', model: 'claude-opus-4-8' })).resolves.toEqual({ next: true });
    expect(mockState.quota).toEqual([['u1', 'free', 'aiTokens', 1]]);
  });
  test('támadás: szóközös kulcs → szintén mért', async () => {
    await run({ provider: 'anthropic', model: 'x', apiKey: '   ' });
    expect(mockState.quota).toEqual([['u1', 'free', 'aiTokens', 1]]);
  });
  test('valódi BYOK-kulcs → kvóta nélkül átenged (a user költsége)', async () => {
    await expect(run({ provider: 'anthropic', model: 'x', apiKey: 'sk-user' })).resolves.toEqual({ next: true });
    expect(mockState.quota).toEqual([]);
  });
});
