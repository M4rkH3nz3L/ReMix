import { followerGrowth, remixAnalytics, type FollowerSnapshot, type RemixSource } from '@/lib/creatorAnalytics';

describe('remixAnalytics', () => {
  const posts: RemixSource[] = [
    { id: 'a', views: 1000, remixes: 10 },
    { id: 'b', views: 500, remixes: 0 },
    { id: 'c', views: 2000, remixes: 40 },
  ];

  it('összesít + arányokat számol', () => {
    const r = remixAnalytics(posts);
    expect(r.totalRemixes).toBe(50);
    expect(r.totalViews).toBe(3500);
    expect(r.remixRate).toBeCloseTo(50 / 3500);
    expect(r.remixedShare).toBeCloseTo(2 / 3); // 'a' és 'c' remixelt
  });

  it('topRemixed csökkenő, a 0-remix kimarad, top-N limitál', () => {
    expect(remixAnalytics(posts, 1).topRemixed).toEqual([{ id: 'c', remixes: 40 }]);
    expect(remixAnalytics(posts).topRemixed.map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('üres halmaz → nulla (nem oszt nullával)', () => {
    expect(remixAnalytics([])).toEqual({
      totalRemixes: 0,
      totalViews: 0,
      remixRate: 0,
      remixedShare: 0,
      topRemixed: [],
    });
  });
});

describe('followerGrowth', () => {
  const snaps: FollowerSnapshot[] = [
    { at: '2026-10-01T00:00:00Z', followers: 100 },
    { at: '2026-10-03T00:00:00Z', followers: 160 }, // +60 két nap alatt
    { at: '2026-10-05T00:00:00Z', followers: 170 }, // +10
  ];

  it('nettó + napi ráta + legjobb felfutás (rendezetlen inputot is rendez)', () => {
    const g = followerGrowth([snaps[2], snaps[0], snaps[1]]);
    expect(g.current).toBe(170);
    expect(g.net).toBe(70); // 170 - 100
    expect(g.ratePerDay).toBeCloseTo(70 / 4); // 4 nap ível át
    expect(g.bestGain).toEqual({ at: '2026-10-03T00:00:00Z', gain: 60 });
  });

  it('egyetlen pillanatkép → net 0, nincs bestGain', () => {
    const g = followerGrowth([{ at: '2026-10-01T00:00:00Z', followers: 42 }]);
    expect(g).toEqual({ current: 42, net: 0, ratePerDay: 0, bestGain: null });
  });

  it('üres / érvénytelen → nulla', () => {
    expect(followerGrowth([])).toEqual({ current: 0, net: 0, ratePerDay: 0, bestGain: null });
    expect(followerGrowth([{ at: 'rossz', followers: 5 }])).toEqual({ current: 0, net: 0, ratePerDay: 0, bestGain: null });
  });

  it('csökkenő követőszámnál a bestGain lehet negatív (a legkevésbé rossz)', () => {
    const g = followerGrowth([
      { at: '2026-10-01T00:00:00Z', followers: 100 },
      { at: '2026-10-02T00:00:00Z', followers: 80 },
      { at: '2026-10-03T00:00:00Z', followers: 75 },
    ]);
    expect(g.net).toBe(-25);
    expect(g.bestGain).toEqual({ at: '2026-10-03T00:00:00Z', gain: -5 });
  });
});
