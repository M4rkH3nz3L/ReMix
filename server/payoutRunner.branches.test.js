// 💸 A payoutRunner.js ágai: az alapértelmezett küldők env-kapuja, a hibaüzenet-normalizálás,
// és a futtató számlálói / hibatűrése. A partner-modulok mockolva — hálózat nincs.
jest.mock('./payouts', () => ({ payoutsConfigured: jest.fn(() => false), sendPayout: jest.fn(async () => 'batch_x') }));
jest.mock('./stripeConnect', () => ({ transferToAccount: jest.fn(async () => 'tr_x') }));
jest.mock('./lib/caught', () => ({ logCaught: jest.fn() }));
const payouts = require('./payouts');
const { transferToAccount } = require('./stripeConnect');
const { logCaught } = require('./lib/caught');
const { executeApproved, runApprovedPayouts, defaultSenders } = require('./payoutRunner');

/** Hamis kliens: rpc → { name, to, ref, note }; a kérések / fiókok listája és hibák konfigurálhatók. */
function fakeSb({ rows = [], accts = {}, listError = null, rpcError = () => null } = {}) {
  const calls = [];
  const queries = [];
  return {
    calls,
    queries,
    rpc: async (name, args) => {
      calls.push({ name, id: args.p_request, to: args.p_to, ref: args.p_provider_ref, note: args.p_note });
      const err = rpcError(args);
      return { data: null, error: err ? { message: err } : null };
    },
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          order: (oc, oo) => ({
            limit: async (n) => {
              queries.push({ table, cols, col, val, oc, oo, n });
              return { data: rows, error: listError };
            },
          }),
          maybeSingle: async () => {
            queries.push({ table, cols, col, val });
            return { data: accts[val] ?? null, error: null };
          },
        }),
      }),
    }),
  };
}
const verified = (provider = 'stripe') => ({ provider, email: 'a@b.c', account_ref: 'acct_1', kyc_status: 'verified' });

const ENV_STRIPE = process.env.STRIPE_SECRET_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  payouts.payoutsConfigured.mockReturnValue(false);
  // az alapértelmezett küldők a process.env-et nézik: determinisztikusan „nincs Stripe-kulcs”
  delete process.env.STRIPE_SECRET_KEY;
});
afterAll(() => {
  if (ENV_STRIPE !== undefined) process.env.STRIPE_SECRET_KEY = ENV_STRIPE;
});

describe('defaultSenders — env-kapu', () => {
  test('semmi nincs bekötve → mindkét küldő null', () => {
    expect(defaultSenders({})).toEqual({ paypal: null, stripe: null });
  });
  test('PayPal bekötve: sendPayout a fiókkal, euró-centtel és a kérés-id-s megjegyzéssel', async () => {
    payouts.payoutsConfigured.mockReturnValue(true);
    const s = defaultSenders({});
    expect(s.stripe).toBeNull();
    const acct = { provider: 'paypal', email: 'a@b.c' };
    await expect(s.paypal(acct, { id: 'r7', amount_eur_cents: 6000 })).resolves.toBe('batch_x');
    expect(payouts.sendPayout).toHaveBeenCalledWith(acct, 6000, 'ReMix payout r7');
  });
  test('Stripe-kulcs megvan: transferToAccount a kapcsolt fiókkal, euró-centtel, a kérés-id-vel', async () => {
    const s = defaultSenders({ STRIPE_SECRET_KEY: 'sk_test_x' });
    expect(s.paypal).toBeNull();
    await expect(s.stripe({ account_ref: 'acct_5' }, { id: 'r8', amount_eur_cents: 1234 })).resolves.toBe('tr_x');
    expect(transferToAccount).toHaveBeenCalledWith({ accountId: 'acct_5', amountEurCents: 1234, requestId: 'r8' });
  });
  test('env nélkül a process.env-et nézi', () => {
    expect(defaultSenders().stripe).toBeNull();
    process.env.STRIPE_SECRET_KEY = 'sk_test_env';
    expect(typeof defaultSenders().stripe).toBe('function');
  });
});

describe('executeApproved — ágak', () => {
  const req = { id: 'r1', amount_eur_cents: 6000 };
  test('fiók nélkül approved, állapotváltás nélkül', async () => {
    const sb = fakeSb();
    await expect(executeApproved(sb, req, null, { paypal: jest.fn() })).resolves.toBe('approved');
    expect(sb.calls).toEqual([]);
  });
  test('ismeretlen partner (nincs ilyen küldő) → approved', async () => {
    const sb = fakeSb();
    await expect(executeApproved(sb, req, { provider: 'wise' }, { paypal: jest.fn(), stripe: jest.fn() })).resolves.toBe('approved');
    expect(sb.calls).toEqual([]);
  });
  test('küldők nélkül az alapértelmezett (env-kapus) küldők: semmi bekötve → approved', async () => {
    const sb = fakeSb();
    await expect(executeApproved(sb, req, { provider: 'paypal', email: 'x' })).resolves.toBe('approved');
    expect(sb.calls).toEqual([]);
  });
  test('a partner ref nélkül tér vissza → paid, null ref', async () => {
    const sb = fakeSb();
    await expect(executeApproved(sb, req, verified(), { stripe: async () => undefined })).resolves.toBe('paid');
    expect(sb.calls).toEqual([
      { name: 'payout_transition', id: 'r1', to: 'processing', ref: null, note: null },
      { name: 'payout_transition', id: 'r1', to: 'paid', ref: null, note: null },
    ]);
  });
  test('a partner hibaüzenete a failed-átmenet megjegyzése (300 karakterre vágva)', async () => {
    const sb = fakeSb();
    const long = 'x'.repeat(400);
    await expect(executeApproved(sb, req, verified(), { stripe: async () => { throw new Error(long); } })).resolves.toBe('failed');
    expect(sb.calls[1]).toEqual({ name: 'payout_transition', id: 'r1', to: 'failed', ref: null, note: 'x'.repeat(300) });
    expect(logCaught).toHaveBeenCalledWith('payoutRunner.js:executeApproved', expect.any(Error));
  });
  test('nem-Error dobás (szöveg / üzenet nélküli objektum) is megjegyzéssé válik', async () => {
    const sb = fakeSb();
    await executeApproved(sb, req, verified(), { stripe: async () => { throw 'elutasítva'; } });
    expect(sb.calls[1].note).toBe('elutasítva');
    const sb2 = fakeSb();
    await executeApproved(sb2, req, verified(), { stripe: async () => { throw { code: 42 }; } });
    expect(sb2.calls[1].note).toBe('[object Object]');
    const sb3 = fakeSb();
    await executeApproved(sb3, req, verified(), { stripe: async () => { throw null; } });
    expect(sb3.calls[1].note).toBe('null');
  });
  test('a failed-átmenet hibája dob (a kérés processing-ben marad, utalás nem ment ki)', async () => {
    const sb = fakeSb({ rpcError: (a) => (a.p_to === 'failed' ? 'db le' : null) });
    await expect(executeApproved(sb, req, verified(), { stripe: async () => { throw new Error('elutasítva'); } })).rejects.toThrow('db le');
    expect(sb.calls.map((c) => c.to)).toEqual(['processing', 'failed']);
  });
  test('sikeres utalás, de a paid-írás bukik: processing, a naplóban a partner-ref (vagy „nincs ref”)', async () => {
    const sb = fakeSb({ rpcError: (a) => (a.p_to === 'paid' ? 'conn reset' : null) });
    await expect(executeApproved(sb, req, verified(), { stripe: async () => 'tr_9' })).resolves.toBe('processing');
    expect(logCaught.mock.calls[0][0]).toBe('payoutRunner.js:executeApproved:paid');
    expect(logCaught.mock.calls[0][1].message).toBe('utalva (tr_9), de a paid-írás elbukott: conn reset');
    const sb2 = fakeSb({ rpcError: (a) => (a.p_to === 'paid' ? 'conn reset' : null) });
    await expect(executeApproved(sb2, req, verified(), { stripe: async () => '' })).resolves.toBe('processing');
    expect(logCaught.mock.calls[1][1].message).toBe('utalva (nincs ref), de a paid-írás elbukott: conn reset');
  });
});

describe('runApprovedPayouts — ágak', () => {
  test('service_role nélkül no-op', async () => {
    await expect(runApprovedPayouts(null, {})).resolves.toEqual({ paid: 0, failed: 0, waiting: 0 });
  });
  test('a lekérdezés alakja: approved, legrégebbi elöl, alapból 20; egyedi limit', async () => {
    const sb = fakeSb();
    await runApprovedPayouts(sb, {});
    await runApprovedPayouts(sb, {}, 5);
    expect(sb.queries).toEqual([
      { table: 'payout_requests', cols: 'id, user_id, cents, amount_eur_cents', col: 'status', val: 'approved', oc: 'created_at', oo: { ascending: true }, n: 20 },
      { table: 'payout_requests', cols: 'id, user_id, cents, amount_eur_cents', col: 'status', val: 'approved', oc: 'created_at', oo: { ascending: true }, n: 5 },
    ]);
  });
  test('vegyes köteg: paid / failed / várakozó (nincs fiók, nem ellenőrzött, nincs partner) helyesen számolva', async () => {
    const rows = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u, i) => ({ id: `r${i + 1}`, user_id: u, amount_eur_cents: 1000 }));
    const accts = {
      u1: verified('stripe'),
      u2: verified('paypal'),
      // u3: nincs kifizetési fiók
      u4: { ...verified('stripe'), kyc_status: 'rejected' },
      u5: verified('wise'),
    };
    const sb = fakeSb({ rows, accts });
    const senders = { stripe: jest.fn(async () => 'tr'), paypal: jest.fn(async () => { throw new Error('receiver unconfirmed'); }) };
    await expect(runApprovedPayouts(sb, senders)).resolves.toEqual({ paid: 1, failed: 1, waiting: 3 });
    expect(senders.stripe).toHaveBeenCalledTimes(1);
    expect(sb.calls.map((c) => [c.id, c.to])).toEqual([
      ['r1', 'processing'],
      ['r1', 'paid'],
      ['r2', 'processing'],
      ['r2', 'failed'],
    ]);
    expect(sb.queries.filter((q) => q.table === 'payout_accounts').map((q) => [q.cols, q.col, q.val])).toEqual(
      ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => ['provider, email, account_ref, kyc_status', 'user_id', u])
    );
  });
  // KÉRDÉS: a „pénz elment, de a paid-írás bukott” (processing) végállapot a `waiting` számlálóba esik, így a
  // futás eredményéből nem látszik, hogy kézi egyeztetés kell. Kellene-e külön számláló (pl. `stuck`)?
  test('utalva, de paid-írás bukott → waiting-ként számolva [mai viselkedés]', async () => {
    const sb = fakeSb({ rows: [{ id: 'r1', user_id: 'u1', amount_eur_cents: 1000 }], accts: { u1: verified() }, rpcError: (a) => (a.p_to === 'paid' ? 'x' : null) });
    await expect(runApprovedPayouts(sb, { stripe: async () => 'tr' })).resolves.toEqual({ paid: 0, failed: 0, waiting: 1 });
  });
  test('a lista lekérdezésének hibája: naplózva, üres eredmény', async () => {
    const sb = fakeSb({ listError: { message: 'lista le' } });
    await expect(runApprovedPayouts(sb, {})).resolves.toEqual({ paid: 0, failed: 0, waiting: 0 });
    expect(logCaught).toHaveBeenCalledWith('payoutRunner.js:runApprovedPayouts', expect.objectContaining({ message: 'lista le' }));
  });
  test('null lista → semmi teendő', async () => {
    const sb = fakeSb({ rows: null });
    await expect(runApprovedPayouts(sb, {})).resolves.toEqual({ paid: 0, failed: 0, waiting: 0 });
  });
  // KÉRDÉS: ha egy kérés processing-átmenete dob (pl. invalid_transition), a külső catch az EGÉSZ köteget
  // leállítja — a sorban utána álló, rendben lévő kérések erre a futásra kimaradnak. Szándékos?
  test('egy kérés processing-hibája a köteg többi kérését is leállítja [mai viselkedés]', async () => {
    const rows = [{ id: 'r1', user_id: 'u1', amount_eur_cents: 1000 }, { id: 'r2', user_id: 'u2', amount_eur_cents: 1000 }];
    const sb = fakeSb({ rows, accts: { u1: verified(), u2: verified() }, rpcError: (a) => (a.p_request === 'r1' ? 'invalid_transition' : null) });
    const stripe = jest.fn(async () => 'tr');
    await expect(runApprovedPayouts(sb, { stripe })).resolves.toEqual({ paid: 0, failed: 0, waiting: 0 });
    expect(stripe).not.toHaveBeenCalled();
    expect(sb.calls.map((c) => c.id)).toEqual(['r1']);
    expect(logCaught).toHaveBeenCalledWith('payoutRunner.js:runApprovedPayouts', expect.objectContaining({ message: 'invalid_transition' }));
  });
  test('küldők nélkül az alapértelmezett küldők (semmi bekötve) → minden ellenőrzött kérés várakozik', async () => {
    const sb = fakeSb({ rows: [{ id: 'r1', user_id: 'u1', amount_eur_cents: 1000 }], accts: { u1: verified('paypal') } });
    await expect(runApprovedPayouts(sb)).resolves.toEqual({ paid: 0, failed: 0, waiting: 1 });
    expect(sb.calls).toEqual([]);
  });
});
