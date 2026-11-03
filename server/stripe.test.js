// 💶 Stripe (PRO-CASH C1.5): aláírás-ellenőrzés, Checkout-paraméterek, eseményterv.
const {
  verifyStripeSignature,
  signStripePayload,
  checkoutParams,
  createCheckoutSession,
  planStripeEvent,
} = require('./stripe');

const SECRET = 'whsec_teszt';
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

describe('verifyStripeSignature', () => {
  const now = 1800000000;
  test('a helyes aláírás elfogadva', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, now), SECRET, now)).toBe(true);
  });
  test('ismert Stripe-példa: t=…,v1=… a dokumentált képlettel', () => {
    // HMAC-SHA256("whsec_teszt", "1800000000.{...}") — független újraszámolással
    const crypto = require('crypto');
    const v1 = crypto.createHmac('sha256', SECRET).update(`${now}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,v1=${v1}`, SECRET, now)).toBe(true);
  });
  test('módosított törzs, rossz titok, lejárt időbélyeg → elutasítva', () => {
    const h = signStripePayload(body, SECRET, now);
    expect(verifyStripeSignature(body + ' ', h, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, h, 'whsec_mas', now)).toBe(false);
    expect(verifyStripeSignature(body, h, SECRET, now + 301)).toBe(false);
    expect(verifyStripeSignature(body, 'v1=abc', SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, '', SECRET, now)).toBe(false);
  });
  test('Buffer-törzzsel is', () => {
    expect(verifyStripeSignature(Buffer.from(body), signStripePayload(body, SECRET, now), SECRET, now)).toBe(true);
  });
});

describe('checkoutParams', () => {
  test('bruttó ár (5 € / Coin), Stripe Tax, metaadat a sessionön és a payment intenten', () => {
    const p = checkoutParams({ userId: 'u1', packId: 'coins_10', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('5000');
    expect(p.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(p.get('line_items[0][price_data][tax_behavior]')).toBe('inclusive');
    expect(p.get('automatic_tax[enabled]')).toBe('true');
    expect(p.get('metadata[user_id]')).toBe('u1');
    expect(p.get('payment_intent_data[metadata][pack_id]')).toBe('coins_10');
    expect(p.get('custom_text[submit][message]')).toContain('14 napos elállási jogod megszűnik');
  });
  test('ismeretlen csomag → null', () => {
    expect(checkoutParams({ userId: 'u1', packId: 'coins_7', successUrl: 'a', cancelUrl: 'b' })).toBeNull();
  });
  test('createCheckoutSession: a Stripe API-t a titkos kulccsal hívja', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) };
    };
    const out = await createCheckoutSession({ userId: 'u1', packId: 'coins_1', successUrl: 'a', cancelUrl: 'b' }, { STRIPE_SECRET_KEY: 'sk_test_x' }, fetchImpl);
    expect(out).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
    expect(calls[0][0]).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(calls[0][1].headers.Authorization).toBe('Bearer sk_test_x');
  });
});

describe('planStripeEvent', () => {
  const session = (extra) => ({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', metadata: { user_id: 'u1', pack_id: 'coins_25' }, ...extra } } });
  test('kifizetett session → vásárolt + bónusz', () => {
    expect(planStripeEvent(session())).toEqual({ action: 'coins', userId: 'u1', cents: 2500, bonusCents: 200, ref: 'pi_1' });
  });
  test('nem kifizetett (pl. késleltetett banki) → semmi', () => {
    expect(planStripeEvent(session({ payment_status: 'unpaid' })).action).toBe('ignore');
  });
  test('teljes visszatérítés → a csomag + bónusz vissza; részleges → arányosan', () => {
    const charge = (amount_refunded) => ({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 12500, amount_refunded, metadata: { user_id: 'u1', pack_id: 'coins_25' } } } });
    expect(planStripeEvent(charge(12500))).toEqual({ action: 'coins_refund', userId: 'u1', cents: 2700, ref: 'pi_1' });
    expect(planStripeEvent(charge(6250)).cents).toBe(1350);
  });
  test('vitatott terhelés → teljes visszavonás', () => {
    const ev = { type: 'charge.dispute.created', data: { object: { amount: 500, metadata: { user_id: 'u1', pack_id: 'coins_1' } } } };
    expect(planStripeEvent(ev)).toMatchObject({ action: 'coins_refund', cents: 100 });
  });
  test('idegen esemény / metaadat nélkül → semmi', () => {
    expect(planStripeEvent({ type: 'invoice.paid', data: { object: {} } }).action).toBe('ignore');
    expect(planStripeEvent(session({ metadata: {} })).action).toBe('ignore');
  });
});
