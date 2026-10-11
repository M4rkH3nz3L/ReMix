import { planCacheEviction, type CacheEntry } from '@/lib/cacheEvict';

const e = (key: string, size: number, mtime: number): CacheEntry => ({ key, size, mtime });

describe('planCacheEviction — LRU cache-nyírás budgetre (06 §2.9)', () => {
  it('a limit alatti összméret → üres terv (nincs fölös törlés)', () => {
    const plan = planCacheEviction([e('a', 100, 1), e('b', 200, 2)], 1000);
    expect(plan.evict).toEqual([]);
    expect(plan.freed).toBe(0);
    expect(plan.keptBytes).toBe(300);
  });

  it('a limit fölött a LEGRÉGEBBEN módosítottat dobja, amíg befér', () => {
    // total 600, limit 350 → a két legrégebbit (a:100 mtime1, b:150 mtime2) dobja → marad 350
    const plan = planCacheEviction(
      [e('a', 100, 1), e('b', 150, 2), e('c', 350, 3)],
      350
    );
    expect(plan.evict).toEqual(['a', 'b']);
    expect(plan.freed).toBe(250);
    expect(plan.keptBytes).toBe(350);
  });

  it('amint a limit alá ér, MEGÁLL (nem dob fölöslegesen)', () => {
    // total 600, limit 500 → elég a legrégebbi a:100-at dobni → marad 500
    const plan = planCacheEviction([e('a', 100, 1), e('b', 250, 5), e('c', 250, 9)], 500);
    expect(plan.evict).toEqual(['a']);
    expect(plan.keptBytes).toBe(500);
  });

  it('maxBytes = 0 → mindent kidob', () => {
    const plan = planCacheEviction([e('a', 100, 1), e('b', 200, 2)], 0);
    expect(new Set(plan.evict)).toEqual(new Set(['a', 'b']));
    expect(plan.freed).toBe(300);
    expect(plan.keptBytes).toBe(0);
  });

  it('azonos mtime → stabil (bemeneti sorrend)', () => {
    const plan = planCacheEviction([e('x', 100, 5), e('y', 100, 5), e('z', 100, 5)], 100);
    // 300 → 100: a két elsőt dobja a bemeneti sorrendben
    expect(plan.evict).toEqual(['x', 'y']);
    expect(plan.keptBytes).toBe(100);
  });

  it('üres bemenet → üres terv', () => {
    expect(planCacheEviction([], 500)).toEqual({ evict: [], freed: 0, keptBytes: 0 });
  });
});
