import { asTier, isPaidTier, TIER_ORDER, tierMeetsMin, tierRank, type Tier } from '@/lib/tiers';

describe('tiers — előfizetési szint-modell (audit §2.1)', () => {
  test('a sorrend növekvő: free < basic < pro < ultra', () => {
    expect([...TIER_ORDER]).toEqual(['free', 'basic', 'pro', 'ultra']);
    expect(tierRank('free')).toBe(0);
    expect(tierRank('basic')).toBe(1);
    expect(tierRank('pro')).toBe(2);
    expect(tierRank('ultra')).toBe(3);
  });

  test('tierMeetsMin: a magasabb szint lefedi az alacsonyabb minTier-t', () => {
    // ultra user mindent megkap
    for (const min of TIER_ORDER) {
      expect(tierMeetsMin('ultra', min)).toBe(true);
    }
    // free user csak a free-t
    expect(tierMeetsMin('free', 'free')).toBe(true);
    expect(tierMeetsMin('free', 'basic')).toBe(false);
    expect(tierMeetsMin('free', 'pro')).toBe(false);
    // pro user: free/basic/pro igen, ultra nem
    expect(tierMeetsMin('pro', 'basic')).toBe(true);
    expect(tierMeetsMin('pro', 'pro')).toBe(true);
    expect(tierMeetsMin('pro', 'ultra')).toBe(false);
    // basic user: free/basic igen, pro nem
    expect(tierMeetsMin('basic', 'basic')).toBe(true);
    expect(tierMeetsMin('basic', 'pro')).toBe(false);
  });

  test('isPaidTier: minden free fölötti fizetős', () => {
    expect(isPaidTier('free')).toBe(false);
    expect(isPaidTier('basic')).toBe(true);
    expect(isPaidTier('pro')).toBe(true);
    expect(isPaidTier('ultra')).toBe(true);
  });

  test('asTier: érvényes szint átmegy, minden más free', () => {
    for (const t of TIER_ORDER) {
      expect(asTier(t)).toBe(t);
    }
    expect(asTier('PRO')).toBe('free'); // case-sensitive
    expect(asTier('enterprise')).toBe('free');
    expect(asTier(null)).toBe('free');
    expect(asTier(undefined)).toBe('free');
    expect(asTier(3)).toBe('free');
  });

  test('tierRank ismeretlen → free-rang (0)', () => {
    expect(tierRank('xxx' as Tier)).toBe(0);
  });
});
