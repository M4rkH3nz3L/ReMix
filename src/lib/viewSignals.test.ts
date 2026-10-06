import { aggregateByPost, aggregateViews, mergeViewSignals, type ViewEvent } from '@/lib/viewSignals';

describe('aggregateViews', () => {
  it('végignézés = min(1, watched/duration) átlag; a túlnézés 1-re szorítva', () => {
    const agg = aggregateViews([
      { postId: 'p', viewerId: 'u1', watchedMs: 5000, durationMs: 10000 }, // 0.5
      { postId: 'p', viewerId: 'u2', watchedMs: 20000, durationMs: 10000 }, // clamp → 1
    ]);
    expect(agg.views).toBe(2);
    expect(agg.completionRate).toBeCloseTo(0.75);
    expect(agg.uniqueViewers).toBe(2);
    expect(agg.rewatchRate).toBe(0);
  });

  it('újranézés: ugyanaz a néző többször → rewatchRate', () => {
    const agg = aggregateViews([
      { postId: 'p', viewerId: 'u1', watchedMs: 10000, durationMs: 10000 },
      { postId: 'p', viewerId: 'u1', watchedMs: 10000, durationMs: 10000 }, // rewatch
      { postId: 'p', viewerId: 'u2', watchedMs: 10000, durationMs: 10000 },
    ]);
    expect(agg.views).toBe(3);
    expect(agg.uniqueViewers).toBe(2);
    expect(agg.rewatchRate).toBeCloseTo(1 / 3); // 1 ismételt a 3-ból
  });

  it('anonim nézések mind külön egyedinek számítanak (nincs hamis rewatch)', () => {
    const agg = aggregateViews([
      { postId: 'p', watchedMs: 3000, durationMs: 10000 },
      { postId: 'p', watchedMs: 3000, durationMs: 10000 },
    ]);
    expect(agg.uniqueViewers).toBe(2);
    expect(agg.rewatchRate).toBe(0);
  });

  it('0 hossz / 0 nézett → 0 completion (nem oszt nullával)', () => {
    const agg = aggregateViews([{ postId: 'p', viewerId: 'u', watchedMs: 5000, durationMs: 0 }]);
    expect(agg.completionRate).toBe(0);
  });

  it('üres → nulla', () => {
    expect(aggregateViews([])).toEqual({ views: 0, uniqueViewers: 0, completionRate: 0, rewatchRate: 0 });
  });
});

describe('aggregateByPost', () => {
  it('poszt-id szerint csoportosít', () => {
    const events: ViewEvent[] = [
      { postId: 'a', viewerId: 'u1', watchedMs: 10000, durationMs: 10000 },
      { postId: 'b', viewerId: 'u1', watchedMs: 2000, durationMs: 10000 },
      { postId: 'a', viewerId: 'u2', watchedMs: 5000, durationMs: 10000 },
    ];
    const m = aggregateByPost(events);
    expect(m.get('a')?.views).toBe(2);
    expect(m.get('a')?.completionRate).toBeCloseTo(0.75);
    expect(m.get('b')?.completionRate).toBeCloseTo(0.2);
  });
});

describe('mergeViewSignals', () => {
  it('a completionRate-et beírja, a views-ot a nagyobbra emeli', () => {
    const merged = mergeViewSignals({ likes: 10, views: 100 }, { views: 120, uniqueViewers: 100, completionRate: 0.6, rewatchRate: 0.1 });
    expect(merged.completionRate).toBe(0.6);
    expect(merged.views).toBe(120);
    expect(merged.likes).toBe(10); // a meglévő mezők maradnak
  });
  it('nincs aggregátum / 0 nézés → változatlan', () => {
    const base = { likes: 5, views: 50 };
    expect(mergeViewSignals(base, undefined)).toBe(base);
    expect(mergeViewSignals(base, { views: 0, uniqueViewers: 0, completionRate: 0, rewatchRate: 0 })).toBe(base);
  });
});
