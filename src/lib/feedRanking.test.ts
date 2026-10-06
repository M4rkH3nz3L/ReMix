import {
  applyDiversity,
  DEFAULT_WEIGHTS,
  engagementScore,
  freshnessFactor,
  rankBy,
  rankTrending,
  scorePost,
  trendingScore,
  weightedEngagement,
  type PostSignals,
} from '@/lib/feedRanking';

describe('engagementScore (audit §4.3)', () => {
  it('súlyozott interakciók / megtekintés', () => {
    expect(engagementScore({ likes: 10, views: 100 })).toBeCloseTo(0.1);
    // comments 2×, saves 3×, shares 4×, remixes 5×
    expect(engagementScore({ likes: 1, comments: 1, saves: 1, shares: 1, remixes: 1, views: 10 })).toBeCloseTo(1.5);
  });
  it('nincs view → 1-gyel oszt (nem robban)', () => {
    expect(engagementScore({ likes: 5 })).toBe(5);
    expect(engagementScore({})).toBe(0);
  });
});

describe('freshnessFactor', () => {
  it('frissen 1, half-life-nál 0.5, duplánál 0.25', () => {
    expect(freshnessFactor(0, 24)).toBe(1);
    expect(freshnessFactor(24, 24)).toBeCloseTo(0.5);
    expect(freshnessFactor(48, 24)).toBeCloseTo(0.25);
  });
});

describe('scorePost', () => {
  it('a frissebb azonos jelekkel előrébb', () => {
    const sig: PostSignals = { likes: 50, views: 100, completionRate: 0.8 };
    const fresh = scorePost({ ...sig, ageHours: 1 });
    const old = scorePost({ ...sig, ageHours: 100 });
    expect(fresh).toBeGreaterThan(old);
  });
  it('a magas completion + affinitás emeli a pontszámot', () => {
    const low = scorePost({ views: 100, likes: 10, ageHours: 1 });
    const high = scorePost({ views: 100, likes: 10, ageHours: 1, completionRate: 1, creatorAffinity: 1 });
    expect(high).toBeGreaterThan(low);
  });
  it('negatív jel büntet (nem megy 0 alá)', () => {
    const base = scorePost({ views: 100, likes: 10, ageHours: 1 });
    const penalized = scorePost({ views: 100, likes: 10, ageHours: 1, negative: 1 });
    expect(penalized).toBeLessThan(base);
    expect(scorePost({ negative: 1 }, DEFAULT_WEIGHTS)).toBe(0);
  });
});

describe('rankBy', () => {
  it('csökkenő pontszám szerint rendez, azonosnál stabil', () => {
    const posts = [
      { id: 'a', s: { views: 100, likes: 1, ageHours: 1 } },
      { id: 'b', s: { views: 100, likes: 90, ageHours: 1 } },
      { id: 'c', s: { views: 100, likes: 40, ageHours: 1 } },
    ];
    expect(rankBy(posts, (p) => p.s).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('weightedEngagement', () => {
  it('nyers súlyozott összeg, nézettséggel NEM osztva', () => {
    expect(weightedEngagement({ likes: 1, comments: 1, saves: 1, shares: 1, remixes: 1 })).toBe(15);
    expect(weightedEngagement({ likes: 10, views: 1000 })).toBe(10); // a view nem számít bele
  });
});

describe('trendingScore (felkapott — engagement-sebesség)', () => {
  it('azonos engagement: a frissebb jóval előrébb', () => {
    const fresh = trendingScore({ likes: 100, ageHours: 1 });
    const old = trendingScore({ likes: 100, ageHours: 48 });
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeGreaterThan(old * 10); // a gravity drámai esést ad
  });
  it('azonos kor: a több engagement előrébb', () => {
    expect(trendingScore({ likes: 200, ageHours: 5 })).toBeGreaterThan(trendingScore({ likes: 50, ageHours: 5 }));
  });
  it('nincs engagement → 0', () => {
    expect(trendingScore({ ageHours: 3 })).toBe(0);
  });
  it('frissen (ageHours 0) sem oszt ~0-val (offset véd)', () => {
    expect(Number.isFinite(trendingScore({ likes: 10, ageHours: 0 }))).toBe(true);
  });
});

describe('rankTrending', () => {
  it('a sebesség szerint rangsorol (régi-nagy mögé a friss-közepes)', () => {
    const posts = [
      { id: 'viral', s: { likes: 500, ageHours: 2 } },
      { id: 'old-big', s: { likes: 5000, ageHours: 240 } },
      { id: 'slow', s: { likes: 20, ageHours: 2 } },
    ];
    expect(rankTrending(posts, (p) => p.s).map((p) => p.id)).toEqual(['viral', 'slow', 'old-big']);
  });
});

describe('applyDiversity', () => {
  it('nem enged 2-nél több egymás utáni azonos alkotót', () => {
    const items = [
      { id: 1, c: 'X' },
      { id: 2, c: 'X' },
      { id: 3, c: 'X' },
      { id: 4, c: 'Y' },
    ];
    const out = applyDiversity(items, (i) => i.c, 2).map((i) => i.id);
    // az első kettő X mehet, a harmadik X helyett Y-t húz előre
    expect(out.slice(0, 3)).toEqual([1, 2, 4]);
    expect(out[3]).toBe(3);
  });
  it('kevés elem / egyféle alkotó → változatlan', () => {
    const items = [{ id: 1, c: 'X' }, { id: 2, c: 'X' }];
    expect(applyDiversity(items, (i) => i.c, 2).map((i) => i.id)).toEqual([1, 2]);
  });
});
