import {
  localHighlights,
  localHooks,
  localStoryChapters,
  localThumbHeadlines,
  topicOf,
} from '@/lib/localTasks';

/**
 * 🧩 Lokális feladat-magok (local-ai: „mindenből legyen ingyenes local"):
 * determinista sablonok — worker/AI/Pro nélkül is van eredmény.
 */

describe('topicOf', () => {
  it('rövid összefoglaló változatlan, a hosszú szóhatáron vágva + ellipszis', () => {
    expect(topicOf('rövid téma')).toBe('rövid téma');
    const long = topicOf('ez egy nagyon hosszú összefoglaló ami biztosan nem fér el a sablonban');
    expect(long.length).toBeLessThanOrEqual(49);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\s…$/); // nem szóköz előtt vág
  });

  it('whitespace-normalizálás', () => {
    expect(topicOf('  több   szóköz\n\nsortörés  ')).toBe('több szóköz sortörés');
  });
});

describe('localHooks', () => {
  it('6 javaslat, mind nem-üres szöveg + stílus, determinista', () => {
    const hooks = localHooks('hogyan tanultam meg gitározni');
    expect(hooks).toHaveLength(6);
    for (const h of hooks) {
      expect(h.text.trim().length).toBeGreaterThan(0);
      expect(h.style.trim().length).toBeGreaterThan(0);
    }
    expect(localHooks('hogyan tanultam meg gitározni')).toEqual(hooks);
    // a 6 javaslat egymástól különbözik
    expect(new Set(hooks.map((h) => h.text)).size).toBe(6);
  });
});

describe('localThumbHeadlines', () => {
  it('3 különböző, nem-üres cím', () => {
    const list = localThumbHeadlines('30 nap gitár');
    expect(list).toHaveLength(3);
    expect(new Set(list).size).toBe(3);
    for (const h of list) {
      expect(h.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('localHighlights', () => {
  it('a leghosszabb beszéd-szakaszok, időrendben, max 4, min-hossz szűrve', () => {
    const transcript = [
      { start: 0, end: 10, text: 'hosszú blokk eleje' }, // 10 mp
      { start: 20, end: 22, text: 'rövid' }, // 2 mp → kiesik (min 4)
      { start: 30, end: 50, text: 'leghosszabb blokk' }, // 20 mp
    ];
    const h = localHighlights(transcript, 60);
    expect(h).toHaveLength(2);
    expect(h[0].start).toBeLessThan(h[1].start); // időrend
    for (const x of h) {
      expect(x.end - x.start).toBeGreaterThanOrEqual(4);
      expect(x.title.length).toBeGreaterThan(0);
    }
  });

  it('üres átirat → üres lista (a hívó null-ra fordítja)', () => {
    expect(localHighlights([], 60)).toEqual([]);
  });
});

describe('localStoryChapters', () => {
  it('időarányos Hook→Context→Value→CTA ív, rendezve, a hosszon belül', () => {
    const ch = localStoryChapters(60);
    expect(ch.map((c) => c.kind)).toEqual(['hook', 'context', 'value', 'cta']);
    expect(ch[0].start).toBe(0);
    for (let i = 1; i < ch.length; i += 1) {
      expect(ch[i].start).toBeGreaterThan(ch[i - 1].start);
      expect(ch[i].start).toBeLessThanOrEqual(60);
    }
  });

  it('átirattal: a fejezet-kezdet a közeli (±2 mp) beszéd-sor elejére pattan', () => {
    const ch = localStoryChapters(60, [
      { start: 0.4, end: 3, text: 'intro' },
      { start: 8.1, end: 12, text: 'kontextus' }, // 60·0.12 = 7.2 → pattan 8.1-re
      { start: 20.5, end: 24, text: 'érték' }, // 60·0.35 = 21 → pattan 20.5-re
    ]);
    expect(ch.find((c) => c.kind === 'context')?.start).toBe(8.1);
    expect(ch.find((c) => c.kind === 'value')?.start).toBe(20.5);
  });

  it('nagyon rövid videón nem ad összecsúszott ívet', () => {
    expect(localStoryChapters(0.3)).toEqual([]);
    const short = localStoryChapters(3);
    // az 1 mp-nél közelebbi fejezetek kimaradnak
    for (let i = 1; i < short.length; i += 1) {
      expect(short[i].start - short[i - 1].start).toBeGreaterThanOrEqual(1);
    }
  });
});
