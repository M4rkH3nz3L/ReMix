// 🧾 RevenueCat webhook végrehajtása (PRO-CASH C0.5): a terv a DB-hívásokká így válik.
// Hamis service-klienssel: rögzítjük, melyik RPC / tábla-írás megy ki, hálózat nélkül.
const calls = [];
let seen = new Set();
const fakeSb = {
  rpc: async (name, args) => {
    calls.push(['rpc', name, args]);
    return { data: name === 'coin_clawback' ? { recovered_cents: args.p_cents, unrecovered_cents: 0 } : 1000, error: null };
  },
  from: (table) => ({
    select: () => ({
      eq: (_c, id) => ({
        maybeSingle: async () => ({ data: table === 'billing_webhook_events' && seen.has(id) ? { id } : null, error: null }),
      }),
    }),
    upsert: async (row) => { calls.push(['upsert', table, row]); return { error: null }; },
    update: (row) => ({ eq: async () => { calls.push(['update', table, row]); return { error: null }; } }),
    insert: async (row) => { calls.push(['insert', table, row]); if (row.id) seen.add(row.id); return { error: null }; },
  }),
};
jest.mock('./notify', () => ({ adminClient: () => fakeSb }));
const { handleRevenueCatEvent } = require('./billing');

const send = (event) => handleRevenueCatEvent({ event: { app_user_id: 'u1', ...event } });

beforeEach(() => {
  calls.length = 0;
  seen = new Set();
});

test('Coin-csomag: a Coin a vásároltra, a bónusz a bónuszra', async () => {
  await expect(send({ id: 'e1', type: 'NON_RENEWING_PURCHASE', product_id: 'coins_25', transaction_id: 't9' })).resolves.toEqual({ credited: 2500, bonus: 200 });
  const rpcs = calls.filter((c) => c[0] === 'rpc').map((c) => [c[2].p_cents, c[2].p_bucket]);
  expect(rpcs).toEqual([[2500, 'purchased'], [200, 'bonus']]);
});

test('Coin-csomag visszatérítése: coin_clawback a csomag + bónusz összegével', async () => {
  await send({ id: 'e2', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'coins_10' });
  expect(calls.find((c) => c[1] === 'coin_clawback')[2]).toMatchObject({ p_user: 'u1', p_cents: 1050 });
});

test('áruházi előfizetés: a termék szintje íródik, forrás iap, a store-lejárattal', async () => {
  const until = Date.parse('2026-12-03T00:00:00Z');
  await send({ id: 'e3', type: 'INITIAL_PURCHASE', product_id: 'remix_ultra_monthly', expiration_at_ms: until });
  const up = calls.find((c) => c[0] === 'upsert' && c[1] === 'subscriptions')[2];
  expect(up).toMatchObject({ user_id: 'u1', tier: 'ultra', seats: 1, status: 'active', source: 'iap', current_period_end: new Date(until).toISOString() });
});

test('visszatérített előfizetés: azonnal Free', async () => {
  await send({ id: 'e4', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'remix_pro_annual' });
  expect(calls.find((c) => c[0] === 'update' && c[1] === 'subscriptions')[2]).toMatchObject({ tier: 'free', status: 'canceled', source: 'iap' });
});

test('sima lemondás: nem nyúl a szinthez (a lejáratig megmarad)', async () => {
  await expect(send({ id: 'e5', type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', product_id: 'remix_pro_monthly' })).resolves.toMatchObject({ ignored: expect.any(String) });
  expect(calls.filter((c) => c[1] === 'subscriptions')).toEqual([]);
});

test('idegen termék: semmilyen pénz- vagy szint-írás', async () => {
  await send({ id: 'e6', type: 'INITIAL_PURCHASE', product_id: 'idegen_termek' });
  expect(calls.filter((c) => c[0] === 'rpc' || c[1] === 'subscriptions')).toEqual([]);
});

test('idempotencia: ugyanaz az esemény-id másodszor nem ír jóvá', async () => {
  await send({ id: 'e7', type: 'NON_RENEWING_PURCHASE', product_id: 'coins_1' });
  const first = calls.filter((c) => c[0] === 'rpc').length;
  await expect(send({ id: 'e7', type: 'NON_RENEWING_PURCHASE', product_id: 'coins_1' })).resolves.toEqual({ duplicate: true, id: 'e7' });
  expect(calls.filter((c) => c[0] === 'rpc').length).toBe(first);
});
