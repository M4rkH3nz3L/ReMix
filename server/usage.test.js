// 📊 Usage-metering worker-logika (audit §2.2) — a tiszta kvóta-matek + a
// DB nélküli best-effort degradáció. A kvóták AZONOSAK a kliens usageMeter.ts-sel.
const usage = require('./usage');

describe('usage — kvóta-logika', () => {
  test('TIER_QUOTAS monoton + ultra korlátlan (-1)', () => {
    const order = ['free', 'basic', 'pro', 'ultra'];
    const val = (t, m) => (usage.TIER_QUOTAS[t][m] < 0 ? Infinity : usage.TIER_QUOTAS[t][m]);
    for (const m of usage.USAGE_METRICS) {
      for (let i = 1; i < order.length; i++) {
        expect(val(order[i], m)).toBeGreaterThanOrEqual(val(order[i - 1], m));
      }
      expect(usage.isUnlimited(usage.TIER_QUOTAS.ultra, m)).toBe(true);
    }
  });

  test('remaining / canUse', () => {
    const q = usage.quotaFor('free'); // aiTokens: 20000
    expect(usage.remaining(19000, q, 'aiTokens')).toBe(1000);
    expect(usage.canUse(19000, q, 'aiTokens', 1000)).toBe(true);
    expect(usage.canUse(19000, q, 'aiTokens', 1001)).toBe(false);
    expect(usage.remaining(1e9, usage.quotaFor('ultra'), 'aiTokens')).toBe(Infinity);
  });

  test('periodKey UTC YYYY-MM', () => {
    expect(usage.periodKey(new Date('2026-10-06T12:00:00Z'))).toBe('2026-10');
  });

  test('quotaFor ismeretlen tier → free', () => {
    expect(usage.quotaFor('enterprise')).toEqual(usage.TIER_QUOTAS.free);
  });
});

describe('enforceQuota — DB nélkül best-effort MEGENGED', () => {
  // nincs SUPABASE_URL/service_role a tesztben → getAdmin null → getUsage 0 → degradál
  test('ismeretlen metrika → ok', async () => {
    expect(await usage.enforceQuota('u1', 'free', 'nincs', 1)).toEqual({ ok: true, remaining: Infinity });
  });
  test('korlátlan tier → ok (nincs is DB-olvasás)', async () => {
    expect(await usage.enforceQuota('u1', 'ultra', 'aiTokens', 1e9)).toEqual({ ok: true, remaining: Infinity });
  });
  test('free + van metrika, de nincs DB → used=0 → belefér a kvótáig', async () => {
    const r = await usage.enforceQuota('u1', 'free', 'aiTokens', 100);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(usage.TIER_QUOTAS.free.aiTokens); // used=0
  });
  test('getUsage DB nélkül 0', async () => {
    expect(await usage.getUsage('u1', 'aiTokens')).toBe(0);
  });
  test('trackUsage DB nélkül nem dob (best-effort)', async () => {
    await expect(usage.trackUsage('u1', 'aiTokens', 100)).resolves.toBeUndefined();
    await expect(usage.trackUsage('u1', 'aiTokens', -5)).resolves.toBeUndefined(); // negatív → no-op
  });
});

describe('aiTokenCount — provider-válaszból a felhasznált tokenek', () => {
  test('Anthropic: usage.input_tokens + output_tokens', () => {
    expect(usage.aiTokenCount({ usage: { input_tokens: 1200, output_tokens: 800 } })).toBe(2000);
  });
  test('OpenAI: usage.total_tokens', () => {
    expect(usage.aiTokenCount({ usage: { total_tokens: 1500, prompt_tokens: 1000, completion_tokens: 500 } })).toBe(1500);
  });
  test('OpenAI részletes (total nélkül): prompt + completion', () => {
    expect(usage.aiTokenCount({ usage: { prompt_tokens: 900, completion_tokens: 350 } })).toBe(1250);
  });
  test('Ollama: top-level prompt_eval_count + eval_count', () => {
    expect(usage.aiTokenCount({ prompt_eval_count: 640, eval_count: 210 })).toBe(850);
  });
  test('ismeretlen / hiányzó alak → 0 (sosem dob)', () => {
    expect(usage.aiTokenCount(null)).toBe(0);
    expect(usage.aiTokenCount({})).toBe(0);
    expect(usage.aiTokenCount({ foo: 'bar' })).toBe(0);
    expect(usage.aiTokenCount('nem objektum')).toBe(0);
  });
  test('részleges Anthropic-mező is számít (csak output_tokens)', () => {
    expect(usage.aiTokenCount({ usage: { output_tokens: 42 } })).toBe(42);
  });
});

describe('aiUsageContext — AsyncLocalStorage a hívó uid-jához', () => {
  test('store a run() scope-ban látható, kívül üres', () => {
    expect(usage.aiUsageContext.getStore()).toBeUndefined();
    usage.aiUsageContext.run({ uid: 'u42' }, () => {
      expect(usage.aiUsageContext.getStore()).toEqual({ uid: 'u42' });
    });
    expect(usage.aiUsageContext.getStore()).toBeUndefined();
  });
});
