import {
  canonicalTag,
  countHashtags,
  extractHashtags,
  filterByHashtag,
  topHashtags,
  trendingHashtags,
} from '@/lib/hashtags';

type Post = { tags: string[]; ageHours: number };

describe('canonicalTag / extractHashtags', () => {
  it('kanonizál kis-betűre, érvénytelen → null', () => {
    expect(canonicalTag('#ReMix')).toBe('#remix');
    expect(canonicalTag('remix')).toBe('#remix');
    expect(canonicalTag('###')).toBeNull();
  });
  it('szövegből kinyeri a #tag-eket, kis-betű-érzéketlen dedup (megjelenési forma)', () => {
    expect(extractHashtags('Nézd meg #Remix és #remix meg #Edit!')).toEqual(['#Remix', '#Edit']);
    expect(extractHashtags('nincs tag itt')).toEqual([]);
    expect(extractHashtags('')).toEqual([]);
  });
});

describe('countHashtags / topHashtags', () => {
  const posts: Post[] = [
    { tags: ['#remix', '#edit'], ageHours: 1 },
    { tags: ['#Remix', '#vlog'], ageHours: 2 }, // #Remix == #remix
    { tags: ['#remix', '#remix'], ageHours: 3 }, // dupla egy poszton belül → 1
  ];
  const getTags = (p: Post) => p.tags;

  it('kanonikusan csoportosít, posztonként egyszer számol, csökkenő sorrend', () => {
    expect(countHashtags(posts, getTags)).toEqual([
      { tag: '#remix', count: 3 },
      { tag: '#edit', count: 1 },
      { tag: '#vlog', count: 1 },
    ]);
  });
  it('topHashtags limitál', () => {
    expect(topHashtags(posts, getTags, 1)).toEqual([{ tag: '#remix', count: 3 }]);
  });
});

describe('filterByHashtag', () => {
  const posts: Post[] = [
    { tags: ['#remix'], ageHours: 1 },
    { tags: ['#EDIT'], ageHours: 2 },
    { tags: [], ageHours: 3 },
  ];
  it('kanonikus egyezés (kis-nagybetű mindegy)', () => {
    expect(filterByHashtag(posts, 'REMIX', (p) => p.tags)).toHaveLength(1);
    expect(filterByHashtag(posts, '#edit', (p) => p.tags)).toHaveLength(1);
  });
  it('érvénytelen tag → []', () => {
    expect(filterByHashtag(posts, '##', (p) => p.tags)).toEqual([]);
  });
});

describe('trendingHashtags — frissesség-súlyozott', () => {
  it('az azonos összegű tag közül a frissebb előrébb', () => {
    const posts: Post[] = [
      { tags: ['#old'], ageHours: 100 },
      { tags: ['#old'], ageHours: 100 }, // #old: 2 régi előfordulás
      { tags: ['#fresh'], ageHours: 1 }, // #fresh: 1 friss előfordulás
    ];
    const out = trendingHashtags(posts, (p) => p.tags, (p) => p.ageHours);
    expect(out[0].tag).toBe('#fresh'); // a frissesség veri a puszta darabszámot
    const fresh = out.find((t) => t.tag === '#fresh')!;
    const old = out.find((t) => t.tag === '#old')!;
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(old.count).toBe(2); // a darabszám azért megmarad
  });
});
