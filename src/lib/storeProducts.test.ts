import { highestActiveEntitlement, parseStoreProductId, storeProductId } from '@/lib/storeProducts';

describe('storeProducts', () => {
  it('termék-azonosító oda-vissza', () => {
    expect(storeProductId('ultra', 'annual')).toBe('remix_ultra_annual');
    expect(parseStoreProductId('remix_basic_monthly')).toEqual({ tier: 'basic', period: 'monthly' });
    expect(parseStoreProductId('remix_business_monthly')).toBeNull();
    expect(parseStoreProductId('coins_10')).toBeNull();
  });

  it('a legmagasabb aktív entitlement nyer', () => {
    expect(
      highestActiveEntitlement({ basic: { isActive: true }, ultra: { isActive: true, expirationDate: '2026-12-01' } })
    ).toEqual({ tier: 'ultra', expirationDate: '2026-12-01' });
    expect(highestActiveEntitlement({ pro: { isActive: false } })).toBeNull();
    expect(highestActiveEntitlement(null)).toBeNull();
  });
});
