import {
  bayesianRating,
  marketplaceScore,
  rankListings,
  type ListingStats,
} from '@/lib/marketplaceRank';

describe('bayesianRating', () => {
  it('kevés szavazat → a prior (4) felé húz; sok szavazat → a saját rating', () => {
    expect(bayesianRating(5, 0)).toBe(4); // nincs szavazat → tiszta prior
    const lowSample = bayesianRating(5, 1); // 5★/1 review
    const highSample = bayesianRating(4.8, 500); // 4.8★/500 review
    expect(lowSample).toBeLessThan(highSample); // a sok-review-s nyer a bizonytalan 5★ felett
    expect(lowSample).toBeGreaterThan(4); // de azért 4 fölött
    expect(highSample).toBeCloseTo(4.78, 1);
  });
  it('a rating 0–5-re szorítva, a count nem-negatív', () => {
    expect(bayesianRating(9, 10)).toBeLessThanOrEqual(5);
    expect(bayesianRating(-3, -5)).toBe(4); // érvénytelen → prior
  });
});

describe('marketplaceScore', () => {
  const base: ListingStats = { id: 'x', downloads: 100, rating: 4.5, ratingCount: 100, ageHours: 24 };

  it('a frissebb azonos letöltéssel előrébb (letöltés-SEBESSÉG)', () => {
    const fresh = marketplaceScore({ ...base, ageHours: 24 });
    const old = marketplaceScore({ ...base, ageHours: 24 * 30 });
    expect(fresh).toBeGreaterThan(old);
  });
  it('a minőség sosem nullázza a sebességet (új, rating nélküli tétel is látszik)', () => {
    expect(marketplaceScore({ id: 'n', downloads: 10, rating: 0, ratingCount: 0, ageHours: 24 })).toBeGreaterThan(0);
  });
  it('nulla letöltés → 0', () => {
    expect(marketplaceScore({ id: 'z', downloads: 0, rating: 5, ratingCount: 10, ageHours: 24 })).toBe(0);
  });
});

describe('rankListings', () => {
  it('a 4.8★/500 megelőzi az 5★/1-et (bayesiánus), azonos letöltés+kor mellett', () => {
    const listings: ListingStats[] = [
      { id: 'hype', downloads: 100, rating: 5, ratingCount: 1, ageHours: 24 },
      { id: 'solid', downloads: 100, rating: 4.8, ratingCount: 500, ageHours: 24 },
    ];
    expect(rankListings(listings).map((l) => l.id)).toEqual(['solid', 'hype']);
  });
  it('a nagy letöltés-sebesség dominál', () => {
    const listings: ListingStats[] = [
      { id: 'slow', downloads: 10, rating: 5, ratingCount: 100, ageHours: 24 },
      { id: 'viral', downloads: 1000, rating: 4, ratingCount: 100, ageHours: 24 },
    ];
    expect(rankListings(listings)[0].id).toBe('viral');
  });
});
