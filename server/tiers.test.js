const { TIER_ORDER, tierRank, tierMeetsMin, isPaidTier, asTier } = require('./tiers');

describe('server/tiers — 5-tier rangsor', () => {
  test('TIER_ORDER = free<basic<pro<ultra<business', () => {
    expect(TIER_ORDER).toEqual(['free', 'basic', 'pro', 'ultra', 'business']);
  });
  test('tierRank', () => {
    expect(tierRank('free')).toBe(0);
    expect(tierRank('business')).toBe(4);
    expect(tierRank('nope')).toBe(0); // ismeretlen → free-rang
  });
  test('tierMeetsMin: magasabb lefedi az alacsonyabbat', () => {
    expect(tierMeetsMin('business', 'pro')).toBe(true);
    expect(tierMeetsMin('basic', 'basic')).toBe(true);
    expect(tierMeetsMin('free', 'basic')).toBe(false);
    expect(tierMeetsMin('pro', 'ultra')).toBe(false);
  });
  test('isPaidTier: minden free fölötti fizetős', () => {
    expect(isPaidTier('free')).toBe(false);
    for (const t of ['basic', 'pro', 'ultra', 'business']) {
      expect(isPaidTier(t)).toBe(true);
    }
  });
  test('asTier: érvényes átmegy, más → free', () => {
    expect(asTier('ultra')).toBe('ultra');
    expect(asTier('xyz')).toBe('free');
    expect(asTier(null)).toBe('free');
  });
});
