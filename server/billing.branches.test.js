// 💳 A billing.js ágai (pénz-út): szint-aktiválás / megújítás, Coin-jóváírás és -visszavonás,
// RevenueCat- és Stripe-esemény végrehajtása, fail-closed szint-lekérdezés. Hamis service-klienssel:
// rögzítjük, pontosan melyik RPC / tábla-írás megy ki, hálózat és valódi DB nélkül.
let mockSb = null;
jest.mock('./notify', () => ({ adminClient: () => mockSb }));
jest.mock('./lib/caught', () => ({ logCaught: jest.fn() }));
const { logCaught } = require('./lib/caught');
const billing = require('./billing');

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const NO_SB = 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nincs beállítva a workeren.';

/**
 * Konfigurálható hamis Supabase-kliens. `opts`:
 *   sub: a subscriptions-sor (select), subError / subThrows: a select hibája,
 *   upsertError / updateError: írás-hiba, rpc: (name, args) → { data, error }, seen: dedup-id-k.
 */
function makeSb(opts = {}) {
  const calls = [];
  const seen = new Set(opts.seen || []);
  const sb = {
    calls,
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return opts.rpc ? opts.rpc(name, args) : { data: 1000, error: null };
    },
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            calls.push(['select', table, cols, col, val]);
            if (table === 'billing_webhook_events') {
              return { data: seen.has(val) ? { id: val } : null, error: null };
            }
            if (opts.subThrows) {
              throw new Error('kapcsolat megszakadt');
            }
            return { data: opts.sub ?? null, error: opts.subError || null };
          },
        }),
      }),
      upsert: async (row, o) => {
        calls.push(['upsert', table, row, o]);
        return { error: opts.upsertError || null };
      },
      update: (row) => ({
        eq: async (col, val) => {
          calls.push(['update', table, row, col, val]);
          return { error: opts.updateError || null };
        },
      }),
      insert: async (row) => {
        calls.push(['insert', table, row]);
        seen.add(row.id);
        return { error: null };
      },
    }),
  };
  return sb;
}
const rpcs = (sb) => sb.calls.filter((c) => c[0] === 'rpc').map((c) => [c[1], c[2]]);

beforeEach(() => {
  mockSb = null;
  logCaught.mockClear();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('billingAvailable', () => {
  test('service_role nélkül false, vele true', () => {
    expect(billing.billingAvailable()).toBe(false);
    mockSb = makeSb();
    expect(billing.billingAvailable()).toBe(true);
  });
});

describe('activateTier — bemenet-ellenőrzés', () => {
  test('service_role nélkül magyar hibával dob', async () => {
    await expect(billing.activateTier('u1', 'pro')).rejects.toThrow(NO_SB);
  });
  test.each([[undefined], [null], [''], ['   ']])('üres userId (%p) → „userId kötelező.”', async (uid) => {
    mockSb = makeSb();
    await expect(billing.activateTier(uid, 'pro')).rejects.toThrow('userId kötelező.');
    expect(mockSb.calls).toEqual([]);
  });
  test.each([['free'], ['gold'], [undefined]])('nem fizetős / ismeretlen szint (%p) → dob, nincs írás', async (tier) => {
    mockSb = makeSb();
    await expect(billing.activateTier('u1', tier)).rejects.toThrow(`Érvénytelen fizetős szint: ${tier}`);
    expect(mockSb.calls).toEqual([]);
  });
  test('érvénytelen until → „Érvénytelen lejárat (until).”, nincs írás', async () => {
    mockSb = makeSb();
    await expect(billing.activateTier('u1', 'pro', { until: 'nem-dátum' })).rejects.toThrow('Érvénytelen lejárat (until).');
    expect(mockSb.calls).toEqual([]);
  });
  test('az upsert hibája továbbdobódik', async () => {
    mockSb = makeSb({ upsertError: { message: 'rls tilt' } });
    await expect(billing.activateTier('u1', 'pro', { until: NOW + DAY })).rejects.toThrow('rls tilt');
  });
});

describe('activateTier — lejárat és ülésszám', () => {
  const upserted = () => mockSb.calls.find((c) => c[0] === 'upsert');

  test('explicit until (ms): pontosan az lesz a lejárat, nincs olvasás; a userId trimmelve, forrás alapból manual', async () => {
    mockSb = makeSb();
    const until = Date.parse('2027-01-01T00:00:00.000Z');
    await expect(billing.activateTier('  u1 ', 'ultra', { until })).resolves.toEqual({ tier: 'ultra', proUntil: '2027-01-01T00:00:00.000Z' });
    expect(mockSb.calls).toEqual([
      ['upsert', 'subscriptions', { user_id: 'u1', tier: 'ultra', seats: 1, status: 'active', current_period_end: '2027-01-01T00:00:00.000Z', source: 'manual' }, { onConflict: 'user_id' }],
    ]);
  });
  test('explicit until (ISO-szöveg) és saját forrás', async () => {
    mockSb = makeSb();
    await billing.activateTier('u1', 'basic', { until: '2027-02-03T04:05:06Z', source: 'promo' });
    expect(upserted()[2]).toMatchObject({ tier: 'basic', current_period_end: '2027-02-03T04:05:06.000Z', source: 'promo' });
  });
  test('nincs előfizetés-sor: mosttól 30 nap', async () => {
    mockSb = makeSb({ sub: null });
    const out = await billing.activateTier('u1', 'pro');
    expect(out.proUntil).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect(mockSb.calls[0]).toEqual(['select', 'subscriptions', 'current_period_end, tier', 'user_id', 'u1']);
  });
  test('megújítás: még érvényes UGYANAZ a szint → a meglévő lejárattól hosszabbít', async () => {
    const curEnd = NOW + 10 * DAY;
    mockSb = makeSb({ sub: { tier: 'pro', current_period_end: new Date(curEnd).toISOString() } });
    const out = await billing.activateTier('u1', 'pro', { days: 7 });
    expect(out.proUntil).toBe(new Date(curEnd + 7 * DAY).toISOString());
  });
  test('lejárt ugyanilyen szint → mosttól', async () => {
    mockSb = makeSb({ sub: { tier: 'pro', current_period_end: new Date(NOW - DAY).toISOString() } });
    const out = await billing.activateTier('u1', 'pro', { days: 7 });
    expect(out.proUntil).toBe(new Date(NOW + 7 * DAY).toISOString());
  });
  test('épp most lejáró (curEnd === now) → mosttól (szigorú >)', async () => {
    mockSb = makeSb({ sub: { tier: 'pro', current_period_end: new Date(NOW).toISOString() } });
    const out = await billing.activateTier('u1', 'pro', { days: 1 });
    expect(out.proUntil).toBe(new Date(NOW + DAY).toISOString());
  });
  test('MÁS szint érvényes lejárata nem számít → mosttól (szintváltás)', async () => {
    mockSb = makeSb({ sub: { tier: 'basic', current_period_end: new Date(NOW + 20 * DAY).toISOString() } });
    const out = await billing.activateTier('u1', 'pro', { days: 30 });
    expect(out.proUntil).toBe(new Date(NOW + 30 * DAY).toISOString());
  });
  test('ugyanaz a szint lejárat nélkül / hibás lejárattal → mosttól', async () => {
    mockSb = makeSb({ sub: { tier: 'pro', current_period_end: null } });
    expect((await billing.activateTier('u1', 'pro', { days: 2 })).proUntil).toBe(new Date(NOW + 2 * DAY).toISOString());
    mockSb = makeSb({ sub: { tier: 'pro', current_period_end: 'szemét' } });
    expect((await billing.activateTier('u1', 'pro', { days: 2 })).proUntil).toBe(new Date(NOW + 2 * DAY).toISOString());
  });
  test('nem véges days (NaN / szöveg) → alapértelmezett 30 nap', async () => {
    mockSb = makeSb();
    expect((await billing.activateTier('u1', 'pro', { days: NaN })).proUntil).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect((await billing.activateTier('u1', 'pro', { days: '5' })).proUntil).toBe(new Date(NOW + 30 * DAY).toISOString());
  });

  // KÉRDÉS: a megújítás a meglévő sor olvasásának HIBÁJÁT figyelmen kívül hagyja (csak a `data`-t nézi),
  // így egy átmeneti DB-hiba esetén mosttól számol, és a user elveszíti a még hátralévő idejét. Szándékos?
  test('a meglévő sor olvasási hibája → mosttól hosszabbít (a hátralévő idő elvész) [mai viselkedés]', async () => {
    mockSb = makeSb({ sub: null, subError: { message: 'timeout' } });
    const out = await billing.activateTier('u1', 'pro', { days: 30 });
    expect(out.proUntil).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect(logCaught).not.toHaveBeenCalled();
  });

  // KÉRDÉS: a `days` nincs alulról korlátozva — 0 vagy negatív érték „active” státuszú, de már lejárt
  // (vagy azonnal lejáró) előfizetést ír. Kellene-e days > 0 ellenőrzés?
  test('negatív days → a múltba eső lejárat íródik, active státusszal [mai viselkedés]', async () => {
    mockSb = makeSb();
    const out = await billing.activateTier('u1', 'pro', { days: -1 });
    expect(out.proUntil).toBe(new Date(NOW - DAY).toISOString());
    expect(upserted()[2]).toMatchObject({ status: 'active' });
  });

  test.each([
    [undefined, 2],
    [1, 2],
    [0, 2],
    ['abc', 2],
    [5.9, 5],
    ['7', 7],
    [-3, 2],
  ])('Vállalati: seats=%p → %i ülés (min. 2, egészre vágva)', async (seats, expected) => {
    mockSb = makeSb();
    await billing.activateTier('u1', 'business', { until: NOW + DAY, seats });
    expect(upserted()[2]).toMatchObject({ tier: 'business', seats: expected });
  });
  test('nem Vállalati szint: az ülésszám mindig 1, akármit kér', async () => {
    mockSb = makeSb();
    await billing.activateTier('u1', 'ultra', { until: NOW + DAY, seats: 10 });
    expect(upserted()[2].seats).toBe(1);
  });
  test('activatePro = activateTier(…, "pro")', async () => {
    mockSb = makeSb();
    await expect(billing.activatePro('u1', { until: NOW + DAY })).resolves.toEqual({ tier: 'pro', proUntil: new Date(NOW + DAY).toISOString() });
    expect(upserted()[2].tier).toBe('pro');
  });
  test('activatePro opts nélkül: mosttól 30 nap', async () => {
    mockSb = makeSb();
    await expect(billing.activatePro('u1')).resolves.toEqual({ tier: 'pro', proUntil: new Date(NOW + 30 * DAY).toISOString() });
  });
});

describe('grantCoins', () => {
  test('service_role nélkül dob', async () => {
    await expect(billing.grantCoins('u1', 100)).rejects.toThrow(NO_SB);
  });
  test.each([
    ['u1', 0],
    ['u1', -100],
    ['u1', NaN],
    ['u1', 'abc'],
    ['u1', 0.9],
    ['u1', Infinity],
    ['', 100],
    [null, 100],
  ])('érvénytelen (%p, %p) → dob, nincs RPC', async (uid, cents) => {
    mockSb = makeSb();
    await expect(billing.grantCoins(uid, cents)).rejects.toThrow('userId és pozitív összeg (cent-Coin) kötelező.');
    expect(mockSb.calls).toEqual([]);
  });
  test('alapértékek: purchased / topup / null note+ref; az összeg egészre vágva; az új egyenleget adja', async () => {
    mockSb = makeSb({ rpc: () => ({ data: 4321, error: null }) });
    await expect(billing.grantCoins(' u1 ', 150.9)).resolves.toEqual({ balance: 4321 });
    expect(rpcs(mockSb)).toEqual([['grant_coins', { p_user: 'u1', p_cents: 150, p_bucket: 'purchased', p_kind: 'topup', p_note: null, p_ref: null }]]);
  });
  test('szöveges összeg és explicit bucket/kind/note/ref', async () => {
    mockSb = makeSb();
    await billing.grantCoins('u1', '250', 'earned', 'sale', 'n', 'r');
    expect(rpcs(mockSb)[0][1]).toEqual({ p_user: 'u1', p_cents: 250, p_bucket: 'earned', p_kind: 'sale', p_note: 'n', p_ref: 'r' });
  });
  test('RPC-hiba továbbdobódik', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: { message: 'grant tiltva' } }) });
    await expect(billing.grantCoins('u1', 100)).rejects.toThrow('grant tiltva');
  });
});

describe('deactivatePro', () => {
  test('service_role nélkül / üres userId → dob', async () => {
    await expect(billing.deactivatePro('u1')).rejects.toThrow(NO_SB);
    mockSb = makeSb();
    await expect(billing.deactivatePro('  ')).rejects.toThrow('userId kötelező.');
    await expect(billing.deactivatePro(undefined)).rejects.toThrow('userId kötelező.');
    expect(mockSb.calls).toEqual([]);
  });
  test('alapból canceled / manual, Free 1 üléssel', async () => {
    mockSb = makeSb();
    await expect(billing.deactivatePro(' u1 ')).resolves.toEqual({ tier: 'free', proUntil: null });
    expect(mockSb.calls).toEqual([['update', 'subscriptions', { tier: 'free', seats: 1, status: 'canceled', source: 'manual' }, 'user_id', 'u1']]);
  });
  test('explicit státusz és forrás; az írás hibája dob', async () => {
    mockSb = makeSb();
    await billing.deactivatePro('u1', { status: 'expired', source: 'iap' });
    expect(mockSb.calls[0][2]).toEqual({ tier: 'free', seats: 1, status: 'expired', source: 'iap' });
    mockSb = makeSb({ updateError: { message: 'nincs sor' } });
    await expect(billing.deactivatePro('u1')).rejects.toThrow('nincs sor');
  });
});

describe('clawbackCoins', () => {
  test('service_role nélkül dob', async () => {
    await expect(billing.clawbackCoins('u1', 100, 'x')).rejects.toThrow(NO_SB);
  });
  test('a coin_clawback RPC eredményét adja vissza', async () => {
    mockSb = makeSb({ rpc: () => ({ data: { recovered_cents: 60, unrecovered_cents: 40 }, error: null }) });
    await expect(billing.clawbackCoins('u1', 100, 'refund:x')).resolves.toEqual({ recovered_cents: 60, unrecovered_cents: 40 });
    expect(rpcs(mockSb)).toEqual([['coin_clawback', { p_user: 'u1', p_cents: 100, p_note: 'refund:x' }]]);
  });
  test('RPC-hiba továbbdobódik', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: { message: 'clawback hiba' } }) });
    await expect(billing.clawbackCoins('u1', 100, 'x')).rejects.toThrow('clawback hiba');
  });
  // KÉRDÉS: a grantCoins-szal ellentétben a clawbackCoins nem ellenőrzi a userId-t és az összeget
  // (üres user, negatív / nem egész cent változatlanul megy a DB-be). Elég-e, ha ezt az RPC véd ki?
  test('nincs bemenet-ellenőrzés: negatív összeg és üres user is az RPC-hez megy [mai viselkedés]', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: null }) });
    await billing.clawbackCoins('', -50, null);
    expect(rpcs(mockSb)).toEqual([['coin_clawback', { p_user: '', p_cents: -50, p_note: null }]]);
  });
});

describe('processRevenueCatEvent — a terv végrehajtása', () => {
  test('Coin-csomag bónusz nélkül: egyetlen grant_coins, a note termék:tranzakció', async () => {
    mockSb = makeSb();
    await expect(billing.processRevenueCatEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'coins_5', transaction_id: 'tx1' }, 'u1')).resolves.toEqual({ credited: 500, bonus: 0 });
    expect(rpcs(mockSb)).toEqual([['grant_coins', { p_user: 'u1', p_cents: 500, p_bucket: 'purchased', p_kind: 'topup', p_note: 'coins_5:tx1', p_ref: null }]]);
  });
  test('Coin-csomag bónusszal, tranzakció-id nélkül: a note csak a termék', async () => {
    mockSb = makeSb();
    await billing.processRevenueCatEvent({ type: 'INITIAL_PURCHASE', product_id: 'coins_50' }, 'u1');
    expect(rpcs(mockSb).map(([n, a]) => [n, a.p_cents, a.p_bucket, a.p_kind, a.p_note])).toEqual([
      ['grant_coins', 5000, 'purchased', 'topup', 'coins_50'],
      ['grant_coins', 500, 'bonus', 'bonus', 'coins_50'],
    ]);
  });
  test('Coin-visszatérítés: refund:-előtagú note, a clawback eredményével', async () => {
    mockSb = makeSb({ rpc: () => ({ data: { recovered_cents: 1050, unrecovered_cents: 0 }, error: null }) });
    await expect(
      billing.processRevenueCatEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'coins_10', transaction_id: 't2' }, 'u1')
    ).resolves.toEqual({ clawback: { recovered_cents: 1050, unrecovered_cents: 0 } });
    expect(rpcs(mockSb)).toEqual([['coin_clawback', { p_user: 'u1', p_cents: 1050, p_note: 'refund:coins_10:t2' }]]);
  });
  test('megújítás store-lejárat nélkül: a meglévő érvényes lejárattól +30 nap, forrás iap, ajánlói jutalék', async () => {
    const curEnd = NOW + 5 * DAY;
    mockSb = makeSb({ sub: { tier: 'basic', current_period_end: new Date(curEnd).toISOString() }, rpc: () => ({ data: null, error: null }) });
    const out = await billing.processRevenueCatEvent({ type: 'RENEWAL', product_id: 'remix_basic_annual' }, 'u1');
    expect(out).toEqual({ tier: 'basic', proUntil: new Date(curEnd + 30 * DAY).toISOString() });
    expect(mockSb.calls.find((c) => c[0] === 'upsert')[2]).toMatchObject({ tier: 'basic', source: 'iap' });
    expect(rpcs(mockSb)).toEqual([['referral_on_store_payment', { p_user: 'u1', p_tier: 'basic', p_period: 'annual' }]]);
  });
  test('az ajánlói jutalék hibája best-effort: naplózva, a szint-aktiválás eredménye megmarad', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: { message: 'referral hiba' } }) });
    const until = NOW + 30 * DAY;
    await expect(billing.processRevenueCatEvent({ type: 'INITIAL_PURCHASE', product_id: 'remix_pro_monthly', expiration_at_ms: until }, 'u1')).resolves.toEqual({
      tier: 'pro',
      proUntil: new Date(until).toISOString(),
    });
    expect(logCaught).toHaveBeenCalledTimes(1);
    expect(logCaught.mock.calls[0][0]).toBe('billing.js:referral_on_store_payment');
    expect(logCaught.mock.calls[0][1].message).toBe('referral hiba');
  });
  test('EXPIRATION → Free, expired / iap', async () => {
    mockSb = makeSb();
    await expect(billing.processRevenueCatEvent({ type: 'EXPIRATION', product_id: 'remix_ultra_monthly' }, 'u1')).resolves.toEqual({ tier: 'free', proUntil: null });
    expect(mockSb.calls).toEqual([['update', 'subscriptions', { tier: 'free', seats: 1, status: 'expired', source: 'iap' }, 'user_id', 'u1']]);
  });
  test('ismeretlen termék, termék-id nélkül → ignored, semmi írás', async () => {
    mockSb = makeSb();
    await expect(billing.processRevenueCatEvent({ type: 'INITIAL_PURCHASE' }, 'u1')).resolves.toEqual({ ignored: 'unknown_product:-' });
    expect(mockSb.calls).toEqual([]);
  });
});

describe('handleRevenueCatEvent — keret', () => {
  test.each([[undefined], [null], [{}], [{ event: {} }], [{ event: { app_user_id: '' } }]])('app_user_id nélkül (%p) dob', async (body) => {
    mockSb = makeSb();
    await expect(billing.handleRevenueCatEvent(body)).rejects.toThrow('app_user_id hiányzik az eseményből.');
    expect(mockSb.calls).toEqual([]);
  });
  test('esemény-id nélkül: nincs dedup-olvasás és -rögzítés, de a feldolgozás lefut', async () => {
    mockSb = makeSb();
    await expect(billing.handleRevenueCatEvent({ event: { app_user_id: 'u1', type: 'NON_RENEWING_PURCHASE', product_id: 'coins_1' } })).resolves.toEqual({ credited: 100, bonus: 0 });
    expect(mockSb.calls.filter((c) => c[1] === 'billing_webhook_events')).toEqual([]);
  });
  test('numerikus esemény-id szövegként rögzítve, a típussal', async () => {
    mockSb = makeSb();
    await billing.handleRevenueCatEvent({ event: { id: 42, app_user_id: 'u1', type: 'EXPIRATION', product_id: 'remix_pro_monthly' } });
    expect(mockSb.calls.find((c) => c[0] === 'insert')).toEqual(['insert', 'billing_webhook_events', { id: '42', type: 'EXPIRATION' }]);
    await expect(billing.handleRevenueCatEvent({ event: { id: 42, app_user_id: 'u1', type: 'EXPIRATION' } })).resolves.toEqual({ duplicate: true, id: '42' });
  });
  test('figyelmen kívül hagyott esemény is feldolgozottnak rögzül (a retry nem ismétli)', async () => {
    mockSb = makeSb();
    await expect(billing.handleRevenueCatEvent({ event: { id: 'e1', app_user_id: 'u1', type: 'BILLING_ISSUE', product_id: 'remix_pro_monthly' } })).resolves.toEqual({
      ignored: 'subscription:BILLING_ISSUE',
    });
    expect(mockSb.calls.filter((c) => c[0] === 'insert')).toEqual([['insert', 'billing_webhook_events', { id: 'e1', type: 'BILLING_ISSUE' }]]);
  });
});

describe('handleStripeEvent', () => {
  const checkout = (pack, extra = {}) => ({
    id: 'evt_c',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', metadata: { pack_id: pack, user_id: 'u1' }, ...extra } },
  });

  test('Coin-csomag bónusz nélkül: egy grant_coins stripe:<payment_intent> note-tal, majd rögzítés', async () => {
    mockSb = makeSb();
    await expect(billing.handleStripeEvent(checkout('coins_5'))).resolves.toEqual({ credited: 500, bonus: 0 });
    expect(rpcs(mockSb)).toEqual([['grant_coins', { p_user: 'u1', p_cents: 500, p_bucket: 'purchased', p_kind: 'topup', p_note: 'stripe:pi_1', p_ref: null }]]);
    expect(mockSb.calls.find((c) => c[0] === 'insert')[2]).toEqual({ id: 'stripe:evt_c', type: 'checkout.session.completed' });
  });
  test('Coin-csomag bónusszal: vásárolt + bónusz', async () => {
    mockSb = makeSb();
    await expect(billing.handleStripeEvent(checkout('coins_10'))).resolves.toEqual({ credited: 1000, bonus: 50 });
    expect(rpcs(mockSb).map(([, a]) => [a.p_cents, a.p_bucket, a.p_kind])).toEqual([
      [1000, 'purchased', 'topup'],
      [50, 'bonus', 'bonus'],
    ]);
  });
  test('visszatérítés (charge.refunded): arányos clawback refund:stripe:-előtaggal', async () => {
    mockSb = makeSb({ rpc: () => ({ data: { recovered_cents: 525, unrecovered_cents: 0 }, error: null }) });
    const ev = { id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_9', amount: 1000, amount_refunded: 500, metadata: { pack_id: 'coins_10', user_id: 'u1' } } } };
    await expect(billing.handleStripeEvent(ev)).resolves.toEqual({ clawback: { recovered_cents: 525, unrecovered_cents: 0 } });
    expect(rpcs(mockSb)).toEqual([['coin_clawback', { p_user: 'u1', p_cents: 525, p_note: 'refund:stripe:pi_9' }]]);
  });
  test('account.updated → set_kyc_status a terv státuszával', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: null }) });
    const ev = { id: 'evt_k', type: 'account.updated', data: { object: { id: 'acct_9', details_submitted: true, payouts_enabled: true, metadata: { user_id: 'u1' } } } };
    await expect(billing.handleStripeEvent(ev)).resolves.toEqual({ kyc: 'verified' });
    expect(rpcs(mockSb)).toEqual([['set_kyc_status', { p_user: 'u1', p_provider: 'stripe', p_status: 'verified', p_account_ref: 'acct_9' }]]);
    expect(mockSb.calls.find((c) => c[0] === 'insert')[2]).toEqual({ id: 'stripe:evt_k', type: 'account.updated' });
  });
  test('a set_kyc_status hibája dob, és az esemény NEM rögzül (a retry újrapróbálja)', async () => {
    mockSb = makeSb({ rpc: () => ({ data: null, error: { message: 'kyc írás hiba' } }) });
    const ev = { id: 'evt_k2', type: 'account.updated', data: { object: { id: 'acct_9', metadata: { user_id: 'u1' } } } };
    await expect(billing.handleStripeEvent(ev)).rejects.toThrow('kyc írás hiba');
    expect(mockSb.calls.filter((c) => c[0] === 'insert')).toEqual([]);
  });
  // KÉRDÉS: a 'kyc' ág a service-klienst null-ellenőrzés nélkül használja — service_role nélkül
  // TypeError lesz a magyar „nincs beállítva” üzenet helyett (a coins-ágak a grantCoins-on át szépen dobnak).
  test('service_role nélkül a kyc-ág TypeError-ral dob [mai viselkedés]', async () => {
    mockSb = null;
    const ev = { id: 'evt_k3', type: 'account.updated', data: { object: { id: 'acct_9', metadata: { user_id: 'u1' } } } };
    await expect(billing.handleStripeEvent(ev)).rejects.toThrow(TypeError);
  });
  test('figyelmen kívül hagyott esemény → { ignored }, és rögzül', async () => {
    mockSb = makeSb();
    await expect(billing.handleStripeEvent({ id: 'evt_i', type: 'invoice.paid', data: { object: {} } })).resolves.toEqual({ ignored: 'invoice.paid' });
    expect(rpcs(mockSb)).toEqual([]);
    expect(mockSb.calls.find((c) => c[0] === 'insert')[2]).toEqual({ id: 'stripe:evt_i', type: 'invoice.paid' });
  });
  test('nem fizetett checkout → ignored unpaid:<státusz>, semmi jóváírás', async () => {
    mockSb = makeSb();
    await expect(billing.handleStripeEvent(checkout('coins_5', { payment_status: 'unpaid' }))).resolves.toEqual({ ignored: 'unpaid:unpaid' });
    expect(rpcs(mockSb)).toEqual([]);
  });
  test('esemény-id nélkül / üres eseménnyel: nincs dedup és rögzítés', async () => {
    mockSb = makeSb();
    await expect(billing.handleStripeEvent(null)).resolves.toEqual({ ignored: 'unknown' });
    await expect(billing.handleStripeEvent({ type: 'customer.created' })).resolves.toEqual({ ignored: 'customer.created' });
    expect(mockSb.calls).toEqual([]);
  });
});

describe('activeTier / isPro / isPaid — fail-closed', () => {
  test('service_role nélkül → free, DB-hívás nélkül', async () => {
    await expect(billing.activeTier('u1')).resolves.toBe('free');
  });
  test.each([[undefined], [''], ['  ']])('üres userId (%p) → free, nincs lekérdezés', async (uid) => {
    mockSb = makeSb({ sub: { tier: 'ultra', status: 'active', current_period_end: new Date(NOW + DAY).toISOString() } });
    await expect(billing.activeTier(uid)).resolves.toBe('free');
    expect(mockSb.calls).toEqual([]);
  });
  test('érvényes sor → a szint; a userId trimmelve kérdezve', async () => {
    mockSb = makeSb({ sub: { tier: 'ultra', status: 'active', current_period_end: new Date(NOW + DAY).toISOString() } });
    await expect(billing.activeTier(' u1 ')).resolves.toBe('ultra');
    expect(mockSb.calls).toEqual([['select', 'subscriptions', 'tier, status, current_period_end', 'user_id', 'u1']]);
  });
  // KÉRDÉS: a lekérdezés `error`-ja csendben 'free'-t ad (nincs logCaught), míg a dobott hiba naplózódik —
  // egy tartós DB-hiba így minden fizetőt némán Free-re butít. Kellene-e itt is naplózni?
  test('DB-hiba (error mező) → free, naplózás nélkül [mai viselkedés]', async () => {
    mockSb = makeSb({ sub: { tier: 'ultra', status: 'active', current_period_end: new Date(NOW + DAY).toISOString() }, subError: { message: 'db le' } });
    await expect(billing.activeTier('u1')).resolves.toBe('free');
    expect(logCaught).not.toHaveBeenCalled();
  });
  test('dobott DB-hiba → free, naplózva', async () => {
    mockSb = makeSb({ subThrows: true });
    await expect(billing.activeTier('u1')).resolves.toBe('free');
    expect(logCaught).toHaveBeenCalledWith('billing.js:activeTier', expect.objectContaining({ message: 'kapcsolat megszakadt' }));
  });
  test.each([
    ['free', false, false],
    ['basic', false, true],
    ['pro', true, true],
    ['ultra', true, true],
    ['business', true, true],
  ])('%s szint: isPro=%p, isPaid=%p', async (tier, pro, paid) => {
    mockSb = makeSb({ sub: { tier, status: 'active', current_period_end: new Date(NOW + DAY).toISOString() } });
    await expect(billing.isPro('u1')).resolves.toBe(pro);
    await expect(billing.isPaid('u1')).resolves.toBe(paid);
  });
  test('lejárt fizetős sor → isPaid false', async () => {
    mockSb = makeSb({ sub: { tier: 'ultra', status: 'active', current_period_end: new Date(NOW - 1).toISOString() } });
    await expect(billing.isPaid('u1')).resolves.toBe(false);
  });
});
