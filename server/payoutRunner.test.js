// 💸 Kifizetés-végrehajtás (C3.3) + Stripe Connect: az állapotgép-hívások sorrendje, a partner
// hibája failed-et ad (a DB visszaír), partner nélkül kézi teljesítés; a Connect API-hívások alakja.
const { executeApproved, runApprovedPayouts } = require('./payoutRunner');
const { createExpressAccount, onboardingLink, transferToAccount, kycStatusFromAccount } = require('./stripeConnect');
const { planStripeEvent } = require('./stripe');

function fakeSb(rows = [], acct = null) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push([name, args.p_to, args.p_provider_ref ?? null]); return { data: null, error: null }; },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: table === 'payout_requests' ? rows : [], error: null }) }),
          maybeSingle: async () => ({ data: acct, error: null }),
        }),
      }),
    }),
  };
}
const req = { id: 'r1', amount_eur_cents: 6000 };

describe('executeApproved', () => {
  test('approved → processing → paid, a partner-azonosítóval', async () => {
    const sb = fakeSb();
    const end = await executeApproved(sb, req, { provider: 'stripe', account_ref: 'acct_1' }, { stripe: async () => 'tr_1' });
    expect(end).toBe('paid');
    expect(sb.calls).toEqual([['payout_transition', 'processing', null], ['payout_transition', 'paid', 'tr_1']]);
  });
  test('a partner hibája → failed (a DB írja vissza a Coint)', async () => {
    const sb = fakeSb();
    const end = await executeApproved(sb, req, { provider: 'paypal', email: 'x' }, { paypal: async () => { throw new Error('receiver unconfirmed'); } });
    expect(end).toBe('failed');
    expect(sb.calls.map((c) => c[1])).toEqual(['processing', 'failed']);
  });
  test('bekötött partner nélkül approved marad (kézi teljesítés)', async () => {
    const sb = fakeSb();
    await expect(executeApproved(sb, req, { provider: 'paypal' }, { paypal: null })).resolves.toBe('approved');
    expect(sb.calls).toEqual([]);
  });
});

describe('runApprovedPayouts', () => {
  test('csak ellenőrzött (KYC) fiókot fizet ki', async () => {
    const sb = fakeSb([{ id: 'r1', user_id: 'u1', amount_eur_cents: 6000 }], { provider: 'stripe', account_ref: 'acct_1', kyc_status: 'pending' });
    await expect(runApprovedPayouts(sb, { stripe: async () => 'tr' })).resolves.toEqual({ paid: 0, failed: 0, waiting: 1 });
    const ok = fakeSb([{ id: 'r1', user_id: 'u1', amount_eur_cents: 6000 }], { provider: 'stripe', account_ref: 'acct_1', kyc_status: 'verified' });
    await expect(runApprovedPayouts(ok, { stripe: async () => 'tr' })).resolves.toEqual({ paid: 1, failed: 0, waiting: 0 });
  });
});

describe('Stripe Connect', () => {
  const env = { STRIPE_SECRET_KEY: 'sk_test_x' };
  const recorder = () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init, body: new URLSearchParams(init.body) }); return { ok: true, json: async () => ({ id: 'acct_9', url: 'https://connect.stripe.com/x' }) }; };
    return { calls, fetchImpl };
  };
  test('Express-fiók: csak utalás-fogadás, a user az metaadatban, idempotens', async () => {
    const r = recorder();
    await expect(createExpressAccount({ userId: 'u1', email: 'a@b.c' }, env, r.fetchImpl)).resolves.toBe('acct_9');
    expect(r.calls[0].url).toBe('https://api.stripe.com/v1/accounts');
    expect(r.calls[0].body.get('type')).toBe('express');
    expect(r.calls[0].body.get('capabilities[transfers][requested]')).toBe('true');
    expect(r.calls[0].body.get('metadata[user_id]')).toBe('u1');
    expect(r.calls[0].init.headers['Idempotency-Key']).toBe('acct-u1');
  });
  test('onboarding-link és utalás (euró-cent, a kérés-id az idempotencia-kulcs)', async () => {
    const r = recorder();
    await onboardingLink({ accountId: 'acct_9', refreshUrl: 'a', returnUrl: 'b' }, env, r.fetchImpl);
    await transferToAccount({ accountId: 'acct_9', amountEurCents: 6000, requestId: 'r1' }, env, r.fetchImpl);
    expect(r.calls[0].body.get('type')).toBe('account_onboarding');
    expect(r.calls[1].url).toBe('https://api.stripe.com/v1/transfers');
    expect(r.calls[1].body.get('amount')).toBe('6000');
    expect(r.calls[1].body.get('currency')).toBe('eur');
    expect(r.calls[1].init.headers['Idempotency-Key']).toBe('payout-r1');
  });
  test('KYC-állapot a fiókból', () => {
    expect(kycStatusFromAccount({ details_submitted: true, payouts_enabled: true })).toBe('verified');
    expect(kycStatusFromAccount({ details_submitted: true, payouts_enabled: false })).toBe('pending');
    expect(kycStatusFromAccount({ requirements: { disabled_reason: 'rejected.fraud' } })).toBe('rejected');
  });
  test('account.updated webhook → kyc terv', () => {
    const ev = { type: 'account.updated', data: { object: { id: 'acct_9', details_submitted: true, payouts_enabled: true, metadata: { user_id: 'u1' } } } };
    expect(planStripeEvent(ev)).toEqual({ action: 'kyc', userId: 'u1', accountRef: 'acct_9', status: 'verified' });
  });
});
