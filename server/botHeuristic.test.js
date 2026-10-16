const { clusterByShared, payoutFarmingRisk, velocitySpike } = require('./botHeuristic');

describe('clusterByShared — sok fiók → egy közös kulcs (§06.3)', () => {
  test('payout-cél 3+ user → gyanús klaszter', () => {
    const links = [
      { userId: 'u1', key: 'farm@paypal.com' },
      { userId: 'u2', key: 'farm@paypal.com' },
      { userId: 'u3', key: 'farm@paypal.com' },
      { userId: 'u4', key: 'legit@paypal.com' },
    ];
    const r = clusterByShared(links, { minUsers: 3 });
    expect(r.suspicious).toBe(true);
    expect(r.flagged).toEqual(['farm@paypal.com']);
    expect(r.clusters[0]).toMatchObject({ key: 'farm@paypal.com', count: 3 });
  });

  test('ugyanaz a user többször NEM számít külön fióknak (distinct userId)', () => {
    const links = [
      { userId: 'u1', key: 'x' },
      { userId: 'u1', key: 'x' },
      { userId: 'u1', key: 'x' },
    ];
    expect(clusterByShared(links, { minUsers: 3 }).suspicious).toBe(false);
  });

  test('küszöb alatt → nem gyanús; üres/rossz input → nincs klaszter', () => {
    expect(clusterByShared([{ userId: 'a', key: 'k' }], { minUsers: 3 }).suspicious).toBe(false);
    expect(clusterByShared(null).clusters).toEqual([]);
    expect(clusterByShared([{ key: 'k' }, { userId: 'u' }]).clusters).toEqual([]);
  });

  test('több klaszter count szerint csökkenőbe rendezve', () => {
    const links = [
      { userId: 'a', key: 'big' },
      { userId: 'b', key: 'big' },
      { userId: 'c', key: 'big' },
      { userId: 'd', key: 'small' },
      { userId: 'e', key: 'small' },
    ];
    const r = clusterByShared(links, { minUsers: 2 });
    expect(r.clusters.map((c) => c.key)).toEqual(['big', 'small']);
    expect(r.clusters[0].count).toBe(3);
  });
});

describe('payoutFarmingRisk — célzott alias (alap minUsers 3)', () => {
  test('3 fiók egy célra → flagged', () => {
    const links = ['a', 'b', 'c'].map((u) => ({ userId: u, key: 't@p.com' }));
    expect(payoutFarmingRisk(links).suspicious).toBe(true);
  });
});

describe('velocitySpike — signup/gift/promo-spam', () => {
  const now = 1_000_000;
  test('max felett → spike', () => {
    const ts = Array.from({ length: 12 }, () => now - 1000);
    expect(velocitySpike(ts, now, { windowMs: 60_000, max: 10 })).toMatchObject({ spike: true, count: 12 });
  });
  test('max alatt / ablakon kívüli nem számít', () => {
    const ts = [now - 1000, now - 61_000, now - 62_000];
    expect(velocitySpike(ts, now, { windowMs: 60_000, max: 10 }).spike).toBe(false);
  });
});
