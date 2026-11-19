// 💰 A pénz-utak TULAJDONSÁGAI (fast-check, rögzített seed): kerekítés, fail-closed szint,
// visszatérítési korlátok. A példa-tesztek (billing*, stripe, rcEvents, tiers) egy-egy esetet néznek;
// ez a teljes bemeneti teret söpri, és bukáskor a legkisebb ellenpéldát adja.
const fc = require('fast-check');

const { eurValue } = require('./payouts');
const { coinPackFor, planRevenueCatEvent } = require('./rcEvents');
const { planStripeEvent } = require('./stripe');
const { TIER_ORDER, ACTIVE_STATUSES, activeTierFromRow, asTier, tierMeetsMin, tierRank } = require('./tiers');

const OPTS = { seed: 20261119, numRuns: 500 };
const PACKS = ['coins_1', 'coins_5', 'coins_10', 'coins_25', 'coins_50'];
const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('tiers — fail-closed', () => {
  const anyStatus = fc.oneof(fc.constantFrom(...ACTIVE_STATUSES, 'canceled', 'past_due', 'expired', '', 'ACTIVE'), fc.string());
  const anyTier = fc.oneof(fc.constantFrom(...TIER_ORDER), fc.string(), fc.constant(null), fc.integer());
  const anyEnd = fc.oneof(
    fc.integer({ min: -400, max: 400 }).map((d) => new Date(NOW + d * 86400000).toISOString()),
    fc.constantFrom(null, undefined, '', 'holnap', 'NaN'),
  );

  it('csak aktív státusz + jövőbeli lejárat + ismert szint ad fizetős szintet; minden más free', () => {
    fc.assert(
      fc.property(anyStatus, anyTier, anyEnd, (status, tier, end) => {
        const got = activeTierFromRow({ status, tier, current_period_end: end }, NOW);
        const endMs = end ? Date.parse(end) : NaN;
        const valid = ACTIVE_STATUSES.includes(status) && Number.isFinite(endMs) && endMs > NOW;
        expect(got).toBe(valid ? asTier(tier) : 'free');
        expect(TIER_ORDER).toContain(got);
      }),
      OPTS,
    );
  });

  it('hiányzó / nem-objektum sor → free', () => {
    for (const row of [null, undefined, {}, { status: 'active' }]) expect(activeTierFromRow(row, NOW)).toBe('free');
  });

  it('a rang monoton és a min-kapu tranzitív', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIER_ORDER), fc.constantFrom(...TIER_ORDER), fc.constantFrom(...TIER_ORDER), (a, b, c) => {
        expect(tierMeetsMin(a, b)).toBe(tierRank(a) >= tierRank(b));
        if (tierMeetsMin(a, b) && tierMeetsMin(b, c)) expect(tierMeetsMin(a, c)).toBe(true);
        expect(tierMeetsMin(a, 'free')).toBe(true);
      }),
      OPTS,
    );
  });

  it('ismeretlen szint-név sosem ér el fizetős kaput', () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !TIER_ORDER.includes(s)), (s) => {
        expect(asTier(s)).toBe('free');
        expect(tierMeetsMin(s, 'basic')).toBe(false);
      }),
      OPTS,
    );
  });
});

describe('payouts.eurValue — euró-cent → PayPal-összeg', () => {
  it('egész centre: pontosan két tizedes, és visszaolvasva ugyanaz a cent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        const v = eurValue(cents);
        expect(v).toMatch(/^\d+\.\d{2}$/);
        expect(Math.round(Number(v) * 100)).toBe(cents);
      }),
      OPTS,
    );
  });

  it('tört centet LEFELÉ csonkol (sosem utal többet a kértnél)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true }), (cents) => {
        expect(Number(eurValue(cents)) * 100).toBeLessThanOrEqual(cents + 1e-6);
        expect(eurValue(cents)).toBe(eurValue(Math.trunc(cents)));
      }),
      OPTS,
    );
  });
});

describe('Coin-csomagok — RevenueCat és Stripe ugyanazt írja jóvá', () => {
  it('a csomag Coinja és bónusza egész cent-Coin, a bónusz nem negatív', () => {
    for (const id of PACKS) {
      const p = coinPackFor(id);
      expect(Number.isInteger(p.cents) && p.cents > 0).toBe(true);
      expect(Number.isInteger(p.bonusCents) && p.bonusCents >= 0).toBe(true);
    }
  });

  it('a vásárlás és a teljes visszatérítés összege egyezik (nincs kerekítési szivárgás)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PACKS), (id) => {
        const buy = planRevenueCatEvent({ type: 'NON_RENEWING_PURCHASE', product_id: id });
        const refund = planRevenueCatEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: id });
        expect(refund.cents).toBe(buy.cents + buy.bonusCents);
        const stripeBuy = planStripeEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { pack_id: id, user_id: 'u' } } } });
        expect([stripeBuy.cents, stripeBuy.bonusCents]).toEqual([buy.cents, buy.bonusCents]);
      }),
      OPTS,
    );
  });
});

describe('Stripe arányos visszatérítés — determinisztikus kerekítés', () => {
  const refundOf = (id, amount, refunded) =>
    planStripeEvent({ type: 'charge.refunded', data: { object: { amount, amount_refunded: refunded, metadata: { pack_id: id, user_id: 'u' } } } });

  it('0 < visszavont ≤ teljes; egész; felfelé kerekít (a vevő sosem tart meg többet, mint amit fizetett)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PACKS), fc.integer({ min: 1, max: 100_000 }), fc.nat(), (id, amount, r) => {
        const refunded = 1 + (r % amount);
        const plan = refundOf(id, amount, refunded);
        const pack = coinPackFor(id);
        const total = pack.cents + pack.bonusCents;
        expect(plan.action).toBe('coins_refund');
        expect(Number.isInteger(plan.cents)).toBe(true);
        expect(plan.cents).toBeGreaterThan(0);
        expect(plan.cents).toBeLessThanOrEqual(total);
        expect(plan.cents).toBeGreaterThanOrEqual((total * refunded) / amount);
        expect(plan.cents - (total * refunded) / amount).toBeLessThan(1);
        // determinisztikus: ugyanaz a bemenet → ugyanaz a kimenet
        expect(refundOf(id, amount, refunded)).toEqual(plan);
      }),
      OPTS,
    );
  });

  it('monoton: több visszatérített összeg → legalább annyi visszavont Coin; teljes → a teljes csomag', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PACKS), fc.integer({ min: 2, max: 50_000 }), fc.nat(), fc.nat(), (id, amount, x, y) => {
        const [a, b] = [1 + (x % amount), 1 + (y % amount)].sort((m, n) => m - n);
        expect(refundOf(id, amount, a).cents).toBeLessThanOrEqual(refundOf(id, amount, b).cents);
        const pack = coinPackFor(id);
        expect(refundOf(id, amount, amount).cents).toBe(pack.cents + pack.bonusCents);
      }),
      OPTS,
    );
  });

  it('a vita (dispute) a teljes terhelést vonja vissza', () => {
    for (const id of PACKS) {
      const pack = coinPackFor(id);
      const plan = planStripeEvent({ type: 'charge.dispute.created', data: { object: { amount: 999, metadata: { pack_id: id, user_id: 'u' } } } });
      expect(plan.cents).toBe(pack.cents + pack.bonusCents);
    }
  });

  it('fizetetlen checkout / ismeretlen csomag: nincs jóváírás', () => {
    expect(planStripeEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'unpaid', metadata: { pack_id: 'coins_5', user_id: 'u' } } } }).action).toBe('ignore');
    expect(planStripeEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { pack_id: 'x', user_id: 'u' } } } }).action).toBe('ignore');
    expect(planStripeEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { pack_id: 'coins_5' } } } }).action).toBe('ignore');
  });
});
