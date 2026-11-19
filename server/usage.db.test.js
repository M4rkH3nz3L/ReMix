// 📊 Felhasználás-mérés (usage.js) a DB-ágakon: hamis Supabase-klienssel a kvóta-kikényszerítés
// (egyéni / ülésszámos / add-onos / szervezeti), a felhasználás-írás és a hiteles szint. A tiszta
// kvóta-logika a usage.test.js-ben.
const NOW = new Date('2026-11-19T12:00:00Z');

let mockState;
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => {
    mockState.created.push(args);
    return mockState.client;
  },
}));

function load({ env = true, used = null, usedError = null, extras = null, extrasError = null, extrasThrows = false, pool = null, sub = null, incError = null } = {}) {
  const calls = [];
  mockState = {
    created: [],
    client: {
      from: (table) => {
        const filters = [];
        const q = {
          select: () => q,
          eq: (c, v) => {
            filters.push([c, v]);
            return q;
          },
          maybeSingle: async () => {
            calls.push(['select', table, filters]);
            if (table === 'usage_counters') return { data: used == null ? null : { amount: used }, error: usedError };
            return { data: sub, error: null };
          },
        };
        return q;
      },
      rpc: async (name, args) => {
        calls.push(['rpc', name, args]);
        if (name === 'subscription_quota_for') {
          if (extrasThrows) throw new Error('network');
          return { data: extras, error: extrasError };
        }
        if (name === 'usage_for_quota') return { data: pool, error: null };
        return { data: null, error: incError };
      },
    },
  };
  let mod;
  jest.isolateModules(() => {
    process.env.SUPABASE_URL = env ? 'https://x.supabase.co' : '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = env ? 'svc' : '';
    mod = require('./usage');
  });
  return { usage: mod, calls };
}

const ENV = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
afterAll(() => {
  process.env.SUPABASE_URL = ENV.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.key;
});

describe('getUsage', () => {
  test('a havi számlálót olvassa (user + UTC-periódus + metrika)', async () => {
    const { usage, calls } = load({ used: '42' });
    await expect(usage.getUsage('u1', 'exports', NOW)).resolves.toBe(42);
    expect(calls).toEqual([['select', 'usage_counters', [['user_id', 'u1'], ['period', '2026-11'], ['metric', 'exports']]]]);
  });

  test('nincs sor / nem-szám → 0; user nélkül nincs lekérés', async () => {
    expect(await load({ used: null }).usage.getUsage('u1', 'exports', NOW)).toBe(0);
    expect(await load({ used: 'abc' }).usage.getUsage('u1', 'exports', NOW)).toBe(0);
    const { usage, calls } = load({ used: 5 });
    expect(await usage.getUsage('', 'exports', NOW)).toBe(0);
    expect(calls).toEqual([]);
  });

  // KÉRDÉS: a számláló olvasásának DB-hibája 0-t ad → az enforceQuota ilyenkor ÁTENGED (fail-open), míg
  // a szint-ellenőrzés hiba esetén free-re esik (fail-closed). Szándékos (rendelkezésre állás > költség),
  // vagy a kvóta is zárjon hibánál?
  test('DB-hiba → 0, így a kvóta-kapu átenged [mai viselkedés]', async () => {
    const { usage } = load({ used: 999, usedError: { message: 'down' } });
    expect(await usage.getUsage('u1', 'exports', NOW)).toBe(0);
    await expect(usage.enforceQuota('u1', 'free', 'exports', 1, NOW)).resolves.toEqual({ ok: true, remaining: 15 });
  });

  test('a klienst egyszer hozza létre, munkamenet nélkül', async () => {
    const { usage } = load({ used: 1 });
    await usage.getUsage('u1', 'exports', NOW);
    await usage.getUsage('u1', 'cloudJobs', NOW);
    expect(mockState.created).toHaveLength(1);
    expect(mockState.created[0].slice(0, 2)).toEqual(['https://x.supabase.co', 'svc']);
    expect(mockState.created[0][2].auth).toEqual({ persistSession: false });
  });
});

describe('enforceQuota', () => {
  test('free: nem kérdezi az add-onokat; a keretig enged, felette tilt', async () => {
    const atLimit = load({ used: 14 });
    await expect(atLimit.usage.enforceQuota('u1', 'free', 'exports', 1, NOW)).resolves.toEqual({ ok: true, remaining: 1 });
    expect(atLimit.calls.some((c) => c[1] === 'subscription_quota_for')).toBe(false);
    await expect(load({ used: 15 }).usage.enforceQuota('u1', 'free', 'exports', 1, NOW)).resolves.toEqual({ ok: false, remaining: 0 });
    await expect(load({ used: 14 }).usage.enforceQuota('u1', 'free', 'exports', 2, NOW)).resolves.toEqual({ ok: false, remaining: 1 });
    // a Free felhő-kerete 0
    await expect(load({ used: 0 }).usage.enforceQuota('u1', 'free', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: false, remaining: 0 });
  });

  test('fizetős: az ülésszám és az add-on a keretet emeli', async () => {
    const { usage } = load({ used: 590, extras: { seats: 3, aiTokens: 0, renderMinutes: 15 } });
    // business: 300 perc × 3 ülés + 15 add-on = 915
    await expect(usage.enforceQuota('u1', 'business', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 325 });
  });

  test('az add-on lekérés hibája / kivétele → alap keret (1 ülés, add-on nélkül)', async () => {
    await expect(load({ used: 0, extrasError: { message: 'x' } }).usage.enforceQuota('u1', 'basic', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 30 });
    await expect(load({ used: 0, extrasThrows: true }).usage.enforceQuota('u1', 'basic', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 30 });
    await expect(load({ used: 0, extras: null }).usage.enforceQuota('u1', 'basic', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 30 });
  });

  test('szervezet: a közös keret és a taghatár közül a kisebb köt', async () => {
    const org = (pool, memberLimits) => load({ extras: { seats: 2, orgId: 'o1', memberLimits }, pool });
    // business 2 ülés: 600 perc; pool 550 → 50 maradt; taghatár 100, saját 90 → 10 maradt
    const a = org({ pool: 550, self: 90 }, { renderMinutes: 100 });
    await expect(a.usage.enforceQuota('u1', 'business', 'renderMinutes', 10, NOW)).resolves.toEqual({ ok: true, remaining: 10 });
    expect(a.calls).toContainEqual(['rpc', 'usage_for_quota', { p_user: 'u1', p_period: '2026-11', p_metric: 'renderMinutes' }]);
    await expect(org({ pool: 550, self: 90 }, { renderMinutes: 100 }).usage.enforceQuota('u1', 'business', 'renderMinutes', 11, NOW)).resolves.toEqual({ ok: false, remaining: 10 });
    // taghatár nélkül a pool köt; hiányzó pool-adat = 0
    await expect(org(null, null).usage.enforceQuota('u1', 'business', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 600 });
  });

  test('korlátlan metrika: nincs számláló-olvasás', async () => {
    const { usage, calls } = load({ used: 1e9, extras: { seats: 1 } });
    await expect(usage.enforceQuota('u1', 'pro', 'exports', 1, NOW)).resolves.toEqual({ ok: true, remaining: Infinity });
    expect(calls.some((c) => c[1] === 'usage_counters')).toBe(false);
  });
});

describe('trackUsage', () => {
  test('egész összeget ír a havi számlálóba', async () => {
    const { usage, calls } = load();
    await usage.trackUsage('u1', 'aiTokens', 12.6, NOW);
    expect(calls).toEqual([['rpc', 'increment_usage', { p_user: 'u1', p_period: '2026-11', p_metric: 'aiTokens', p_amount: 13 }]]);
  });

  test('nem ír: user nélkül, ismeretlen metrikára, nem pozitív összegre, DB nélkül', async () => {
    const { usage, calls } = load();
    await usage.trackUsage('', 'aiTokens', 5, NOW);
    await usage.trackUsage('u1', 'pizza', 5, NOW);
    await usage.trackUsage('u1', 'aiTokens', 0, NOW);
    await usage.trackUsage('u1', 'aiTokens', -3, NOW);
    await usage.trackUsage('u1', 'aiTokens', NaN, NOW);
    expect(calls).toEqual([]);
    await expect(load({ env: false }).usage.trackUsage('u1', 'aiTokens', 5, NOW)).resolves.toBeUndefined();
  });

  test('a DB-hiba nem dob (best-effort), csak figyelmeztet', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { usage } = load({ incError: { message: 'down' } });
    await expect(usage.trackUsage('u1', 'exports', 1, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('down'));
    warn.mockRestore();
  });
});

describe('userTier — a hiteles szint', () => {
  test('aktív, nem lejárt sor → a szintje; minden más free', async () => {
    const future = new Date(NOW.getTime() + 86400000).toISOString();
    expect(await load({ sub: { tier: 'pro', status: 'active', current_period_end: future } }).usage.userTier('u1', NOW)).toBe('pro');
    expect(await load({ sub: { tier: 'pro', status: 'active', current_period_end: '2026-11-01T00:00:00Z' } }).usage.userTier('u1', NOW)).toBe('free');
    expect(await load({ sub: null }).usage.userTier('u1', NOW)).toBe('free');
    expect(await load({ sub: { tier: 'pro', status: 'active', current_period_end: future } }).usage.userTier('', NOW)).toBe('free');
    expect(await load({ env: false }).usage.userTier('u1', NOW)).toBe('free');
  });
});

describe('seatQuota / effectiveQuota', () => {
  test('business: legalább 2 ülés, a korlátlan korlátlan marad', () => {
    const { usage } = load();
    expect(usage.seatQuota('business', 0).renderMinutes).toBe(600);
    expect(usage.seatQuota('business', 'x').renderMinutes).toBe(600);
    expect(usage.seatQuota('business', 3.9).renderMinutes).toBe(900);
    expect(usage.seatQuota('business', 5).exports).toBe(-1);
    expect(usage.seatQuota('pro', 5)).toEqual(usage.TIER_QUOTAS.pro);
  });

  test('add-on: csak pozitív egészt ad hozzá, korlátlanhoz nem', () => {
    const { usage } = load();
    expect(usage.effectiveQuota('basic', 1, { renderMinutes: 10.7, aiTokens: -5 })).toMatchObject({ renderMinutes: 40, aiTokens: 200000 });
    expect(usage.effectiveQuota('pro', 1, { exports: 10 }).exports).toBe(-1);
    expect(usage.effectiveQuota('basic', 1, null)).toEqual(usage.TIER_QUOTAS.basic);
  });
});

describe('határesetek — hiányzó mezők és alapértékek', () => {
  test('hiányzó metrika a kvótában = 0 (nem korlátlan); hiányzó felhasználás = 0', () => {
    const { usage } = load();
    expect(usage.isUnlimited({}, 'exports')).toBe(false);
    expect(usage.remaining(undefined, { exports: 5 }, 'exports')).toBe(5);
    expect(usage.remaining(3, {}, 'exports')).toBe(0);
    expect(usage.canUse(4, { exports: 5 }, 'exports')).toBe(true);
    expect(usage.canUse(5, { exports: 5 }, 'exports')).toBe(false);
  });

  test('aiTokenCount: a hiányzó részmezők 0-nak számítanak', () => {
    const { usage } = load();
    expect(usage.aiTokenCount({ usage: { input_tokens: 7 } })).toBe(7);
    expect(usage.aiTokenCount({ usage: { prompt_tokens: 4 } })).toBe(4);
    expect(usage.aiTokenCount({ usage: { completion_tokens: 6 } })).toBe(6);
    expect(usage.aiTokenCount({ eval_count: 9 })).toBe(9);
    expect(usage.aiTokenCount({ prompt_eval_count: 2 })).toBe(2);
    expect(usage.aiTokenCount({ usage: 'nem objektum', total_tokens: 3 })).toBe(3);
  });

  test('orgRemaining: hiányzó metrika / pool / saját = 0', () => {
    const { usage } = load();
    expect(usage.orgRemaining({}, 'renderMinutes', {}, null)).toBe(0);
    expect(usage.orgRemaining({ renderMinutes: 10 }, 'renderMinutes', {}, 4)).toBe(4);
    expect(usage.orgRemaining({ renderMinutes: 10 }, 'renderMinutes', { pool: 'x', self: 'y' }, null)).toBe(10);
  });

  test('effectiveQuota alapértékekkel (1 ülés, add-on nélkül)', () => {
    const { usage } = load();
    expect(usage.effectiveQuota('basic')).toEqual(usage.TIER_QUOTAS.basic);
  });

  test('az add-on válasz hiányzó ülésszáma = 1', async () => {
    const { usage } = load({ used: 0, extras: { renderMinutes: 'x' } });
    await expect(usage.enforceQuota('u1', 'business', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 600 });
  });

  test('DB nélkül a fizetős szint az alap-keretet kapja (nincs add-on, nincs szervezet)', async () => {
    const { usage } = load({ env: false });
    await expect(usage.enforceQuota('u1', 'basic', 'renderMinutes', 1, NOW)).resolves.toEqual({ ok: true, remaining: 30 });
  });

  test('alapértelmezett „most” időpont és egy egységnyi igény', async () => {
    const { usage, calls } = load({ used: 0 });
    await expect(usage.enforceQuota('u1', 'free', 'exports')).resolves.toEqual({ ok: true, remaining: 15 });
    await usage.getUsage('u1', 'exports');
    await usage.trackUsage('u1', 'exports', 1);
    await usage.userTier('u1');
    const period = usage.periodKey(new Date());
    expect(calls.filter((c) => c[1] === 'usage_counters').every((c) => c[2].some(([k, v]) => k === 'period' && v === period))).toBe(true);
  });
});
