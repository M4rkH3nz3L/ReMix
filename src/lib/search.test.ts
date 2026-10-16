import {
  normalizeQuery,
  trigrams,
  trigramSimilarity,
  editDistance,
  editSimilarity,
  fuzzySimilarity,
  didYouMean,
  searchRelevance,
  scoreItem,
  rankSearchResults,
  TYPE_WEIGHT,
  type SearchItem,
} from '@/lib/search';

describe('normalizeQuery', () => {
  it('trim + kisbetű + whitespace-összevonás', () => {
    expect(normalizeQuery('  ReMix   Studio ')).toBe('remix studio');
    expect(normalizeQuery('')).toBe('');
  });
});

describe('trigrams — pg_trgm-azonos szó-padding', () => {
  it("show_trgm('cat') = {'  c',' ca','cat','at '}", () => {
    expect([...trigrams('cat')].sort()).toEqual(['  c', ' ca', 'at ', 'cat'].sort());
  });
  it('többszavas: a szavak trigramjainak uniója', () => {
    expect(trigrams('cat dog')).toEqual(new Set(['  c', ' ca', 'cat', 'at ', '  d', ' do', 'dog', 'og ']));
  });
});

describe('trigramSimilarity — Jaccard 0–1 (pg_trgm-tükör)', () => {
  it('azonos → 1; teljesen más → alacsony; üres → 0', () => {
    expect(trigramSimilarity('remix', 'remix')).toBe(1);
    expect(trigramSimilarity('remix', 'zzzzz')).toBeLessThan(0.1);
    expect(trigramSimilarity('', '')).toBe(0);
  });
});

describe('editDistance / editSimilarity / fuzzySimilarity — typo-tolerancia', () => {
  it('Levenshtein alaptávok', () => {
    expect(editDistance('remix', 'remix')).toBe(0);
    expect(editDistance('studio', 'studo')).toBe(1); // törlés
    expect(editDistance('remix', 'reimx')).toBe(2); // transzpozíció = 2 csere
    expect(editDistance('', 'abc')).toBe(3);
  });
  it('editSimilarity normalizált 0–1', () => {
    expect(editSimilarity('studio', 'studo')).toBeCloseTo(1 - 1 / 6, 10);
    expect(editSimilarity('remix', 'reimx')).toBeCloseTo(1 - 2 / 5, 10); // 0.6
  });
  it('fuzzySimilarity = max(trigram, edit) → egy betű elírás is talál', () => {
    expect(fuzzySimilarity('remix', 'reimx')).toBeGreaterThan(0.4);
    expect(fuzzySimilarity('studio', 'studo')).toBeGreaterThan(0.4);
    expect(fuzzySimilarity('remix', 'xylophone')).toBeLessThan(0.3);
  });
});

describe('didYouMean — legközelebbi jelölt a küszöb felett', () => {
  const candidates = ['remix', 'studio', 'creator', 'template'];
  it('elírást javít', () => {
    expect(didYouMean('reimx', candidates)).toBe('remix');
    expect(didYouMean('studoi', candidates)).toBe('studio');
  });
  it('nincs elég közeli → null', () => {
    expect(didYouMean('xylophone', candidates)).toBeNull();
  });
  it('döntetlennél az első jelölt stabil', () => {
    expect(didYouMean('aaa', ['aaa', 'aaa'])).toBe('aaa');
  });
});

describe('searchRelevance — egzakt > prefix > részszó > fuzzy', () => {
  it('monoton erősségi sorrend', () => {
    const exact = searchRelevance('remix', 'remix');
    const prefix = searchRelevance('rem', 'remix studio');
    const substr = searchRelevance('mix', 'remix');
    const fuzzy = searchRelevance('reimx', 'remix');
    expect(exact).toBe(1);
    expect(prefix).toBe(0.9);
    expect(substr).toBe(0.7);
    expect(fuzzy).toBeLessThanOrEqual(0.6);
    expect(fuzzy).toBeGreaterThan(0);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(fuzzy);
  });
  it('üres query/text → 0', () => {
    expect(searchRelevance('', 'remix')).toBe(0);
    expect(searchRelevance('remix', '')).toBe(0);
  });
});

describe('scoreItem / rankSearchResults — egységes heterogén rangsor', () => {
  it('a navigációs típus (user) döntetlennél előrébb', () => {
    const user: SearchItem = { text: 'remix', type: 'user' };
    const post: SearchItem = { text: 'remix', type: 'post' };
    expect(scoreItem('remix', user)).toBeGreaterThan(scoreItem('remix', post));
    expect(TYPE_WEIGHT.user).toBeGreaterThan(TYPE_WEIGHT.post);
  });

  it('relevancia dominál a típus-súly felett (pontos post > fuzzy user)', () => {
    const items: SearchItem[] = [
      { text: 'reimx', type: 'user' }, // fuzzy
      { text: 'remix', type: 'post' }, // egzakt
    ];
    expect(rankSearchResults('remix', items)[0].text).toBe('remix');
  });

  it('a küszöb alatti relevancia kiesik', () => {
    const items: SearchItem[] = [
      { text: 'remix', type: 'post' },
      { text: 'teljesen más', type: 'post' },
    ];
    const out = rankSearchResults('remix', items);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('remix');
  });

  it('népszerűség/frissesség csak tie-breaker (azonos relevancián)', () => {
    const items: SearchItem[] = [
      { text: 'remix', type: 'post', popularity: 0, ageHours: 1000 },
      { text: 'remix', type: 'post', popularity: 10_000, ageHours: 0 },
    ];
    const out = rankSearchResults('remix', items);
    expect(out[0].popularity).toBe(10_000); // a népszerűbb+frissebb előre
  });

  it('üres input → üres', () => {
    expect(rankSearchResults('remix', [])).toEqual([]);
  });
});
