// 🧾 RevenueCat-esemény → teendő (PRO-CASH C0.5): minden eseménytípus × terméktípus.
const { planRevenueCatEvent, coinPackFor, subscriptionProduct } = require('./rcEvents');

const ev = (type, product_id, extra = {}) => ({ type, product_id, ...extra });

describe('Coin-csomagok (consumable)', () => {
  test('vásárlás: a Coin a vásároltra, a bónusz külön', () => {
    expect(planRevenueCatEvent(ev('NON_RENEWING_PURCHASE', 'coins_25'))).toEqual({
      action: 'coins', cents: 2500, bonusCents: 200, product: 'coins_25',
    });
    expect(planRevenueCatEvent(ev('INITIAL_PURCHASE', 'coins_1'))).toMatchObject({ cents: 100, bonusCents: 0 });
  });
  test('visszatérítés: CANCELLATION + CUSTOMER_SUPPORT → a csomag és a bónusza vissza', () => {
    expect(planRevenueCatEvent(ev('CANCELLATION', 'coins_10', { cancel_reason: 'CUSTOMER_SUPPORT' }))).toEqual({
      action: 'coins_refund', cents: 1050, product: 'coins_10',
    });
  });
  test('ismeretlen mennyiség (coins_7) nem a mi termékünk', () => {
    expect(coinPackFor('coins_7')).toBeNull();
    expect(planRevenueCatEvent(ev('NON_RENEWING_PURCHASE', 'coins_7')).action).toBe('ignore');
  });
  test('a régi credits_<n> termék már nem ír jóvá', () => {
    expect(planRevenueCatEvent(ev('NON_RENEWING_PURCHASE', 'credits_500')).action).toBe('ignore');
  });
});

describe('áruházi előfizetés szintenként', () => {
  test('a termék-azonosítóból jön a szint', () => {
    expect(subscriptionProduct('remix_ultra_annual')).toEqual({ tier: 'ultra', period: 'annual' });
    expect(subscriptionProduct('remix_business_monthly')).toBeNull(); // a Vállalati nem áruházi
  });
  test.each(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED'])(
    '%s → grant a store-lejáratig',
    (type) => {
      expect(planRevenueCatEvent(ev(type, 'remix_basic_monthly', { expiration_at_ms: 1800000000000 }))).toEqual({
        action: 'grant', tier: 'basic', until: 1800000000000,
        paid: type === 'INITIAL_PURCHASE' || type === 'RENEWAL', period: 'monthly',
      });
    }
  );
  test('EXPIRATION → revoke (expired)', () => {
    expect(planRevenueCatEvent(ev('EXPIRATION', 'remix_pro_monthly'))).toEqual({ action: 'revoke', status: 'expired' });
  });
  test('visszatérítés (CANCELLATION + CUSTOMER_SUPPORT) → azonnali revoke', () => {
    expect(planRevenueCatEvent(ev('CANCELLATION', 'remix_pro_annual', { cancel_reason: 'CUSTOMER_SUPPORT' }))).toEqual({
      action: 'revoke', status: 'canceled',
    });
  });
  test.each(['UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED'])(
    'sima lemondás (%s) → a lejáratig megmarad',
    (reason) => {
      expect(planRevenueCatEvent(ev('CANCELLATION', 'remix_pro_monthly', { cancel_reason: reason })).action).toBe('ignore');
    }
  );
  test('BILLING_ISSUE / TRANSFER → nem nyúl a szinthez', () => {
    expect(planRevenueCatEvent(ev('BILLING_ISSUE', 'remix_pro_monthly')).action).toBe('ignore');
    expect(planRevenueCatEvent(ev('TRANSFER', 'remix_pro_monthly')).action).toBe('ignore');
  });
  test('nem létező REFUND esemény sem von vissza', () => {
    expect(planRevenueCatEvent(ev('REFUND', 'remix_pro_monthly')).action).toBe('ignore');
  });
});

describe('idegen termék', () => {
  test('ismeretlen termékre semmi (a webhook csak a saját termékét írja)', () => {
    expect(planRevenueCatEvent(ev('INITIAL_PURCHASE', 'valami_mas'))).toEqual({ action: 'ignore', reason: 'unknown_product:valami_mas' });
    expect(planRevenueCatEvent({})).toMatchObject({ action: 'ignore' });
  });
});
