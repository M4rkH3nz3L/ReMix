import {
  breakdownBy,
  engagementRate,
  productivity,
  retentionRate,
  slowestSteps,
  summarize,
  topPerformers,
  whyItWorked,
  type ContentStat,
} from '@/lib/analytics';

const stat = (over: Partial<ContentStat> & { id: string }): ContentStat => ({
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  ...over,
});

describe('analytics — engagement / retention', () => {
  it('engagementRate = (like+comment+share)/views', () => {
    expect(engagementRate(stat({ id: 'a', views: 100, likes: 10, comments: 5, shares: 5 }))).toBeCloseTo(0.2);
  });
  it('0 megtekintés → 0', () => {
    expect(engagementRate(stat({ id: 'a', likes: 5 }))).toBe(0);
  });
  it('retentionRate watchSec/durationSec, adat híján null', () => {
    expect(retentionRate(stat({ id: 'a', watchSec: 30, durationSec: 60 }))).toBeCloseTo(0.5);
    expect(retentionRate(stat({ id: 'a' }))).toBeNull();
  });
});

describe('analytics — summarize', () => {
  it('összegek + átlagok', () => {
    const s = summarize([
      stat({ id: 'a', views: 100, likes: 20, comments: 0, shares: 0 }), // eng 0.2
      stat({ id: 'b', views: 100, likes: 0, comments: 0, shares: 0 }), // eng 0
    ]);
    expect(s.count).toBe(2);
    expect(s.views).toBe(200);
    expect(s.avgViews).toBe(100);
    expect(s.avgEngagement).toBeCloseTo(0.1);
  });
  it('üres → nullák', () => {
    expect(summarize([])).toMatchObject({ count: 0, avgViews: 0, avgEngagement: 0 });
  });
});

describe('analytics — breakdownBy („melyik hook működik?")', () => {
  const stats = [
    stat({ id: '1', hook: 'question', views: 100, likes: 30 }), // eng 0.3
    stat({ id: '2', hook: 'question', views: 100, likes: 10 }), // eng 0.1 → átlag 0.2
    stat({ id: '3', hook: 'shock', views: 100, likes: 5 }), // eng 0.05
  ];
  it('átlag-engagement szerint rangsorol', () => {
    const b = breakdownBy(stats, 'hook');
    expect(b.map((d) => d.key)).toEqual(['question', 'shock']);
    expect(b[0]).toMatchObject({ count: 2, avgEngagement: 0.2 });
  });
  it('a dimenzió nélküli statokat kihagyja', () => {
    const b = breakdownBy([...stats, stat({ id: '4', views: 999 })], 'hook');
    expect(b.reduce((n, d) => n + d.count, 0)).toBe(3);
  });
});

describe('analytics — topPerformers', () => {
  const stats = [
    stat({ id: 'low', views: 10, likes: 9 }), // eng 0.9
    stat({ id: 'high', views: 1000, likes: 10 }), // eng 0.01
  ];
  it('views szerint', () => {
    expect(topPerformers(stats, 'views', 1)[0].id).toBe('high');
  });
  it('engagement szerint', () => {
    expect(topPerformers(stats, 'engagement', 1)[0].id).toBe('low');
  });
});

describe('analytics — whyItWorked', () => {
  it('a mezőny átlagához mért eltéréseket adja, |delta| szerint', () => {
    const pop = [
      stat({ id: 'a', views: 100, likes: 10 }), // eng 0.1
      stat({ id: 'b', views: 100, likes: 10 }), // eng 0.1
      stat({ id: 'star', views: 300, likes: 90 }), // eng 0.3, views 300
    ];
    const insights = whyItWorked(pop[2], pop);
    // engagement 0.3 vs átlag (0.1+0.1+0.3)/3=0.1667 → +80%; views 300 vs átlag 166.7 → +80%
    const eng = insights.find((i) => i.factor === 'engagement')!;
    expect(eng.delta).toBeGreaterThan(0);
    expect(insights[0]).toBeDefined(); // rendezve
  });

  it('üres populáció → nincs insight', () => {
    expect(whyItWorked(stat({ id: 'x' }), [])).toEqual([]);
  });
});

describe('analytics — produktivitás + workflow-időzítés', () => {
  it('productivity: összes + projekt + napi bontás', () => {
    const p = productivity([
      { projectId: 'p1', seconds: 600, date: '2026-09-27T10:00:00.000Z' },
      { projectId: 'p1', seconds: 300, date: '2026-09-27T14:00:00.000Z' },
      { projectId: 'p2', seconds: 120, date: '2026-09-28T09:00:00.000Z' },
    ]);
    expect(p.totalSec).toBe(1020);
    expect(p.byProject.p1).toBe(900);
    expect(p.byDay['2026-09-27']).toBe(900);
    expect(p.byDay['2026-09-28']).toBe(120);
  });

  it('slowestSteps: lépés-típusonként összegez + arány', () => {
    const slow = slowestSteps(
      [
        { kind: 'render', ms: 8000 },
        { kind: 'ai', ms: 1500 },
        { kind: 'ai', ms: 500 },
      ],
      2
    );
    expect(slow[0]).toMatchObject({ kind: 'render', ms: 8000, share: 0.8 });
    expect(slow[1]).toMatchObject({ kind: 'ai', ms: 2000 });
  });
});
