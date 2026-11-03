// 🪙 A tartás-feloldó ütemező: a coin_release_due RPC-t hívja, hibát elnyel (no-op).
const { runCoinSettleOnce } = require('./coinSettle');

describe('runCoinSettleOnce', () => {
  test('service_role nélkül no-op', async () => {
    await expect(runCoinSettleOnce(null)).resolves.toBe(0);
  });
  test('a coin_release_due RPC-t hívja az adott időponttal', async () => {
    const calls = [];
    const sb = { rpc: async (name, args) => { calls.push([name, args]); return { data: 3, error: null }; } };
    const now = new Date('2026-11-03T12:00:00Z');
    await expect(runCoinSettleOnce(sb, now)).resolves.toBe(3);
    expect(calls).toEqual([['coin_release_due', { p_now: '2026-11-03T12:00:00.000Z' }]]);
  });
  test('RPC-hiba → 0, nem dob', async () => {
    const sb = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    await expect(runCoinSettleOnce(sb)).resolves.toBe(0);
  });
});

describe('runSubscriptionCycleOnce (C1.3)', () => {
  const { runSubscriptionCycleOnce, renewalNotice } = require('./coinSettle');
  const now = new Date('2026-11-28T12:00:00Z');

  test('megújít, majd a kevés egyenlegű fiókoknak értesítést küld', async () => {
    const rpc = jest.fn(async (name) =>
      name === 'renew_due_subscriptions'
        ? { data: { renewed: 2, failed: 1, ended: 0 }, error: null }
        : name === 'take_renewal_notices'
          ? { data: [{ user_id: 'u1', period_end: '2026-12-01T00:00:00Z', cost_cents: 400, balance_cents: 150 }], error: null }
          : { data: [{ user_id: 'u2', ends_at: '2026-11-30T00:00:00Z' }], error: null }
    );
    const sent = [];
    const out = await runSubscriptionCycleOnce({ rpc }, now, async (n) => { sent.push(n); });
    expect(out).toEqual({ renewed: 2, failed: 1, ended: 0, notified: 2 });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['renew_due_subscriptions', 'take_renewal_notices', 'take_trial_notices']);
    expect(rpc.mock.calls[0][1]).toEqual({ p_now: '2026-11-28T12:00:00.000Z' });
    expect(sent[0]).toMatchObject({ userId: 'u1', route: '/profile' });
    expect(sent[0].body).toContain('2,50 Coin hiányzik');
    expect(sent[1]).toMatchObject({ userId: 'u2', data: { kind: 'trial_ending' } });
    expect(sent[1].body).toContain('semmit nem terhelünk');
  });

  test('a megújítás hibája nem állítja meg az értesítést; az értesítő hibája nem dob', async () => {
    const rpc = async (name) =>
      name === 'renew_due_subscriptions'
        ? { data: null, error: { message: 'boom' } }
        : name === 'take_renewal_notices'
          ? { data: [{ user_id: 'u1', period_end: '2026-12-01', cost_cents: 1, balance_cents: 0 }], error: null }
          : { data: [], error: null };
    const out = await runSubscriptionCycleOnce({ rpc }, now, async () => { throw new Error('push le'); });
    expect(out).toEqual({ renewed: 0, failed: 0, ended: 0, notified: 0 });
  });

  test('service_role nélkül no-op', async () => {
    await expect(runSubscriptionCycleOnce(null)).resolves.toEqual({ renewed: 0, failed: 0, ended: 0, notified: 0 });
  });

  test('az értesítés a hiányzó összeget mondja', () => {
    expect(renewalNotice({ user_id: 'u', period_end: '2026-12-01T00:00:00Z', cost_cents: 1000, balance_cents: 1000 }).body).toContain('0,00 Coin');
  });
});
