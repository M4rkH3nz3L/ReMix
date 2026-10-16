import {
  aggregateByPost,
  aggregateViews,
  mergeViewSignals,
  negativeSignal,
  QUICK_SKIP_THRESHOLD,
  type ViewEvent,
} from '@/lib/viewSignals';
import { scorePost } from '@/lib/feedRanking';

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

describe('negativeSignal — gyors-átugrás + explicit elrejtés/report (§01.1)', () => {
  const skip: ViewEvent = { postId: 'p', watchedMs: 500, durationMs: 10_000 }; // 0.05 < 0.15 → skip
  const watched: ViewEvent = { postId: 'p', watchedMs: 8_000, durationMs: 10_000 }; // 0.8 → nem skip

  it('a küszöb alatti végignézés gyors-átugrásként számít', () => {
    expect(negativeSignal({ events: [skip, skip, watched] })).toBeCloseTo(2 / 3, 10);
    expect(negativeSignal({ events: [watched, watched] })).toBe(0);
  });

  it('a report a legerősebb jel (×6), az elrejtés ×3', () => {
    expect(negativeSignal({ hides: 1, impressions: 10 })).toBeCloseTo(3 / 10, 10);
    expect(negativeSignal({ reports: 1, impressions: 10 })).toBeCloseTo(6 / 10, 10);
    expect(negativeSignal({ reports: 2, impressions: 10 })).toBe(1); // 12/10 → klamp 1
  });

  it('impressions alapból az események száma; üres → 0', () => {
    expect(negativeSignal({ events: [skip] })).toBe(1); // 1 skip / 1 impression
    expect(negativeSignal({})).toBe(0);
  });

  it('a kimenet a scorePost negativePenalty-ágát hajtja (negatív jel → alacsonyabb rang)', () => {
    const base = { likes: 20, views: 100, ageHours: 1, completionRate: 0.5 };
    const clean = scorePost({ ...base, negative: 0 });
    const noisy = scorePost({ ...base, negative: negativeSignal({ reports: 1, hides: 2, impressions: 10 }) });
    expect(noisy).toBeLessThan(clean);
  });

  it('QUICK_SKIP_THRESHOLD a dokumentált alapérték', () => {
    expect(QUICK_SKIP_THRESHOLD).toBe(0.15);
  });
});
