import type { ContentStat } from '@/lib/analytics';
import { emptyMemory, rankedFacts } from '@/lib/creatorMemory';
import {
  LOOP_STAGES,
  analyticsInsights,
  learnFromAnalytics,
  loopProgress,
  loopStageOf,
} from '@/lib/creatorLoop';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

const stat = (over: Partial<ContentStat> & { id: string }): ContentStat => ({
  views: 100,
  likes: 0,
  comments: 0,
  shares: 0,
  ...over,
});

describe('creatorLoop — loop-fázisok', () => {
  it('a legtávolabb elért fázist adja', () => {
    expect(loopStageOf({})).toBe('create');
    expect(loopStageOf({ saved: true })).toBe('save');
    expect(loopStageOf({ saved: true, shared: true })).toBe('share');
    expect(loopStageOf({ published: true })).toBe('publish');
    expect(loopStageOf({ analyzed: true })).toBe('analyze');
    expect(loopStageOf({ learned: true })).toBe('learn');
  });
  it('loopProgress 0→1 a lánc mentén', () => {
    expect(loopProgress({})).toBe(0);
    expect(loopProgress({ learned: true })).toBe(1);
    expect(LOOP_STAGES).toHaveLength(6);
  });
});

describe('creatorLoop — analyticsInsights', () => {
  const stats = [
    stat({ id: '1', hook: 'question', likes: 30 }), // eng 0.3
    stat({ id: '2', hook: 'question', likes: 10 }), // eng 0.1 → átlag 0.2
    stat({ id: '3', hook: 'shock', likes: 2 }), // eng 0.02
  ];

  it('a mezőny-átlag FÖLÖTT teljesítő győztest adja lift-tel', () => {
    const ins = analyticsInsights(stats, { minSamples: 2 });
    const hook = ins.find((i) => i.dimension === 'hook')!;
    expect(hook.best.key).toBe('question');
    expect(hook.lift).toBeGreaterThan(1);
  });

  it('kevés minta → nem tanul (minSamples)', () => {
    const ins = analyticsInsights(stats, { minSamples: 3 });
    expect(ins.find((i) => i.dimension === 'hook')).toBeUndefined();
  });

  it('egyetlen variáns (nincs mihez hasonlítani) → nincs insight', () => {
    const same = [stat({ id: 'a', hook: 'x', likes: 10 }), stat({ id: 'b', hook: 'x', likes: 10 })];
    expect(analyticsInsights(same, { dimensions: ['hook'] })).toEqual([]);
  });
});

describe('creatorLoop — learnFromAnalytics (AI LEARNS)', () => {
  const stats = [
    stat({ id: '1', hook: 'question', thumbnail: 'face', likes: 30 }),
    stat({ id: '2', hook: 'question', thumbnail: 'face', likes: 10 }),
    stat({ id: '3', hook: 'shock', thumbnail: 'text', likes: 2 }),
  ];

  it('a tanulságokból Creator Memory workflow-tényeket ír', () => {
    const mem = learnFromAnalytics(emptyMemory(T0), stats, { minSamples: 2 }, T0);
    const facts = rankedFacts(mem);
    expect(facts.some((f) => f.key === 'analytics:hook' && f.text.includes('question'))).toBe(true);
    expect(facts.every((f) => f.category === 'workflow')).toBe(true);
  });

  it('ismételt tanulás MEGERŐSÍT (hits++), nem duplikál', () => {
    let mem = learnFromAnalytics(emptyMemory(T0), stats, { minSamples: 2 }, T0);
    const before = mem.facts.length;
    mem = learnFromAnalytics(mem, stats, { minSamples: 2 }, T1);
    expect(mem.facts.length).toBe(before);
    const hookFact = mem.facts.find((f) => f.key === 'analytics:hook')!;
    expect(hookFact.hits).toBe(2);
  });

  it('ha nincs tanulság, a memória változatlan tartalmú', () => {
    const flat = [stat({ id: 'a', hook: 'x', likes: 10 }), stat({ id: 'b', hook: 'x', likes: 10 })];
    const mem = learnFromAnalytics(emptyMemory(T0), flat, {}, T0);
    expect(mem.facts).toHaveLength(0);
  });
});
