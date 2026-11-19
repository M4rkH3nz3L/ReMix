// 🪙 A coinSettle.js ágai: a ciklus négy lépése egymástól független (egyik hibája sem állítja meg a
// többit), soronként egy értesítés hibája sem; értesítő nélkül a notify.sendNotification megy.
jest.mock('./notify', () => ({ sendNotification: jest.fn(async () => undefined) }));
jest.mock('./lib/caught', () => ({ logCaught: jest.fn() }));
const { sendNotification } = require('./notify');
const { logCaught } = require('./lib/caught');
const { runCoinSettleOnce, runSubscriptionCycleOnce, renewalNotice, trialNotice, storageGraceNotice } = require('./coinSettle');

const NOW = new Date('2026-11-28T12:00:00.000Z');
const P_NOW = { p_now: '2026-11-28T12:00:00.000Z' };
const RENEW_ROW = { user_id: 'u1', period_end: '2026-12-01T00:00:00Z', cost_cents: 400, balance_cents: 150 };
const TRIAL_ROW = { user_id: 'u2', ends_at: '2026-11-30T00:00:00Z' };
const GRACE_ROW = { user_id: 'u3', grace_until: '2026-12-05T00:00:00Z', over_bytes: 1073741824 };

/** RPC-hamisító: név → { data, error } vagy dobó függvény. */
function makeRpc(map) {
  return jest.fn(async (name) => {
    const r = map[name];
    if (typeof r === 'function') {
      return r();
    }
    return r || { data: [], error: null };
  });
}
const whereLogged = () => logCaught.mock.calls.map((c) => c[0]);

beforeEach(() => {
  sendNotification.mockClear();
  logCaught.mockClear();
});

describe('runCoinSettleOnce — ágak', () => {
  test('null / nem szám adat → 0, hiba nélkül', async () => {
    await expect(runCoinSettleOnce({ rpc: async () => ({ data: null, error: null }) }, NOW)).resolves.toBe(0);
    await expect(runCoinSettleOnce({ rpc: async () => ({ data: 'x', error: null }) }, NOW)).resolves.toBe(0);
    expect(logCaught).not.toHaveBeenCalled();
  });
  test('szöveges szám → szám', async () => {
    await expect(runCoinSettleOnce({ rpc: async () => ({ data: '7', error: null }) }, NOW)).resolves.toBe(7);
  });
  test('RPC-hiba és dobott hiba → 0, naplózva', async () => {
    await expect(runCoinSettleOnce({ rpc: async () => ({ data: 5, error: { message: 'boom' } }) }, NOW)).resolves.toBe(0);
    await expect(runCoinSettleOnce({ rpc: async () => { throw new Error('hálózat'); } }, NOW)).resolves.toBe(0);
    expect(logCaught.mock.calls.map((c) => [c[0], c[1].message])).toEqual([
      ['coinSettle.js:runCoinSettleOnce', 'boom'],
      ['coinSettle.js:runCoinSettleOnce', 'hálózat'],
    ]);
  });
  test('alapértelmezett now: a hívás pillanata', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    try {
      const rpc = jest.fn(async () => ({ data: 1, error: null }));
      await runCoinSettleOnce({ rpc });
      expect(rpc).toHaveBeenCalledWith('coin_release_due', P_NOW);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('runSubscriptionCycleOnce — független lépések', () => {
  test('a megújítás null adata → 0-k; üres / null értesítő-listák', async () => {
    const rpc = makeRpc({
      renew_due_subscriptions: { data: null, error: null },
      take_renewal_notices: { data: null, error: null },
      take_trial_notices: { data: null, error: null },
      take_storage_grace_notices: { data: null, error: null },
    });
    const notify = jest.fn();
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toEqual({ renewed: 0, failed: 0, ended: 0, notified: 0 });
    expect(rpc.mock.calls).toEqual([
      ['renew_due_subscriptions', P_NOW],
      ['take_renewal_notices', P_NOW],
      ['take_trial_notices', P_NOW],
      ['take_storage_grace_notices', P_NOW],
    ]);
    expect(notify).not.toHaveBeenCalled();
    expect(logCaught).not.toHaveBeenCalled();
  });
  test('részleges megújítás-adat: a hiányzó mezők 0-k', async () => {
    const rpc = makeRpc({ renew_due_subscriptions: { data: { ended: 4 }, error: null } });
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, jest.fn())).resolves.toEqual({ renewed: 0, failed: 0, ended: 4, notified: 0 });
  });
  test('a megújítási értesítők lekérésének hibája nem állítja meg a próba- és tárhely-értesítőket', async () => {
    const rpc = makeRpc({
      renew_due_subscriptions: { data: { renewed: 1, failed: 0, ended: 0 }, error: null },
      take_renewal_notices: { data: null, error: { message: 'renewal le' } },
      take_trial_notices: { data: [TRIAL_ROW], error: null },
      take_storage_grace_notices: { data: [GRACE_ROW], error: null },
    });
    const notify = jest.fn(async () => undefined);
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toEqual({ renewed: 1, failed: 0, ended: 0, notified: 2 });
    expect(notify.mock.calls.map((c) => c[0].userId)).toEqual(['u2', 'u3']);
    expect(whereLogged()).toEqual(['coinSettle.js:runSubscriptionCycleOnce:notices']);
  });
  test('a próba-értesítők lekérésének hibája nem állítja meg a tárhely-értesítőt', async () => {
    const rpc = makeRpc({
      take_renewal_notices: { data: [RENEW_ROW], error: null },
      take_trial_notices: { data: null, error: { message: 'trial le' } },
      take_storage_grace_notices: { data: [GRACE_ROW], error: null },
    });
    const notify = jest.fn(async () => undefined);
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toMatchObject({ notified: 2 });
    expect(notify.mock.calls.map((c) => c[0].userId)).toEqual(['u1', 'u3']);
    expect(whereLogged()).toEqual(['coinSettle.js:runSubscriptionCycleOnce:trials']);
  });
  test('a tárhely-értesítők lekérésének hibája (dobva is) naplózva, a többi megmarad', async () => {
    const rpc = makeRpc({
      take_renewal_notices: { data: [RENEW_ROW], error: null },
      take_trial_notices: { data: [TRIAL_ROW], error: null },
      take_storage_grace_notices: () => { throw new Error('grace le'); },
    });
    const notify = jest.fn(async () => undefined);
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toMatchObject({ notified: 2 });
    expect(logCaught.mock.calls.map((c) => [c[0], c[1].message])).toEqual([['coinSettle.js:runSubscriptionCycleOnce:grace', 'grace le']]);
  });
  test('a tárhely-RPC error mezője is a grace-naplóba kerül', async () => {
    const rpc = makeRpc({ take_storage_grace_notices: { data: [GRACE_ROW], error: { message: 'x' } } });
    const notify = jest.fn();
    await runSubscriptionCycleOnce({ rpc }, NOW, notify);
    expect(notify).not.toHaveBeenCalled();
    expect(whereLogged()).toEqual(['coinSettle.js:runSubscriptionCycleOnce:grace']);
  });
  test('soronkénti értesítő-hiba: a sor kimarad, a többi sor és lépés megy; minden típus a saját helyére naplóz', async () => {
    const rpc = makeRpc({
      take_renewal_notices: { data: [RENEW_ROW, { ...RENEW_ROW, user_id: 'u1b' }], error: null },
      take_trial_notices: { data: [TRIAL_ROW, { ...TRIAL_ROW, user_id: 'u2b' }], error: null },
      take_storage_grace_notices: { data: [GRACE_ROW, { ...GRACE_ROW, user_id: 'u3b' }], error: null },
    });
    const failing = new Set(['u1', 'u2', 'u3']);
    const notify = jest.fn(async (n) => {
      if (failing.has(n.userId)) throw new Error(`push le: ${n.userId}`);
    });
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toEqual({ renewed: 0, failed: 0, ended: 0, notified: 3 });
    expect(notify).toHaveBeenCalledTimes(6);
    expect(whereLogged()).toEqual([
      'coinSettle.js:runSubscriptionCycleOnce:notify',
      'coinSettle.js:runSubscriptionCycleOnce:trialNotify',
      'coinSettle.js:runSubscriptionCycleOnce:graceNotify',
    ]);
  });
  test('hibás dátumú sor: a szöveg-építés dob, csak az a sor marad ki', async () => {
    const rpc = makeRpc({ take_trial_notices: { data: [{ user_id: 'rossz', ends_at: 'nem-dátum' }, TRIAL_ROW], error: null } });
    const notify = jest.fn(async () => undefined);
    await expect(runSubscriptionCycleOnce({ rpc }, NOW, notify)).resolves.toMatchObject({ notified: 1 });
    expect(notify.mock.calls.map((c) => c[0].userId)).toEqual(['u2']);
    expect(whereLogged()).toEqual(['coinSettle.js:runSubscriptionCycleOnce:trialNotify']);
  });
  test('értesítő nélkül a notify.sendNotification küld (mindhárom típus)', async () => {
    const rpc = makeRpc({
      take_renewal_notices: { data: [RENEW_ROW], error: null },
      take_trial_notices: { data: [TRIAL_ROW], error: null },
      take_storage_grace_notices: { data: [GRACE_ROW], error: null },
    });
    await expect(runSubscriptionCycleOnce({ rpc }, NOW)).resolves.toMatchObject({ notified: 3 });
    expect(sendNotification.mock.calls.map((c) => c[0].data.kind)).toEqual(['subscription_renewal', 'trial_ending', 'storage_grace']);
  });
  test('alapértelmezett now: a hívás pillanata', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    try {
      const rpc = makeRpc({});
      await runSubscriptionCycleOnce({ rpc });
      expect(rpc.mock.calls.every((c) => c[1].p_now === P_NOW.p_now)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('értesítés-szövegek', () => {
  test('renewalNotice: teljes alak', () => {
    expect(renewalNotice(RENEW_ROW)).toEqual({
      userId: 'u1',
      type: 'info',
      title: 'Hamarosan megújul az előfizetésed',
      body: '2026-12-01-án megújul, de 2,50 Coin hiányzik. Tölts fel, hogy ne ess vissza Free-re.',
      route: '/profile',
      data: { kind: 'subscription_renewal', period_end: '2026-12-01T00:00:00Z' },
    });
  });
  test('renewalNotice: ha az egyenleg több a díjnál, a hiány 0 (nem negatív)', () => {
    expect(renewalNotice({ ...RENEW_ROW, cost_cents: 100, balance_cents: 900 }).body).toContain('de 0,00 Coin hiányzik');
  });
  test('trialNotice: teljes alak', () => {
    expect(trialNotice(TRIAL_ROW)).toEqual({
      userId: 'u2',
      type: 'info',
      title: 'Hamarosan véget ér az Amatőr-próbád',
      body: '2026-11-30-án lejár, utána Free-re váltasz — semmit nem terhelünk. Ha maradnál, válassz csomagot.',
      route: '/profile',
      data: { kind: 'trial_ending', ends_at: '2026-11-30T00:00:00Z' },
    });
  });
  test('storageGraceNotice: teljes alak, GB egy tizedesre, vesszővel', () => {
    expect(storageGraceNotice(GRACE_ROW)).toEqual({
      userId: 'u3',
      type: 'info',
      title: 'A felhő-tárhelyed a kereten túl van',
      body: '1,0 GB-tal több a keretednél. 2026-12-05-ig töltsd le vagy költöztesd a saját felhődbe, vagy bővíts — törölni semmit nem fogunk.',
      route: '/profile',
      data: { kind: 'storage_grace', grace_until: '2026-12-05T00:00:00Z' },
    });
  });
});
