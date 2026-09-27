import { charCount, extractOutline, readingTimeMin, stripMarkdown, wordCount } from '@/lib/markdown';

describe('markdown — stripMarkdown', () => {
  it('eltávolítja a jelölést, megtartja a link-szöveget', () => {
    expect(stripMarkdown('# Cím\n\n**vastag** és [link](http://x) meg `kód`.')).toBe('Cím vastag és link meg .');
  });

  it('a körülkerített kódblokkot kiveszi', () => {
    expect(stripMarkdown('szöveg\n```\nconst x = 1\n```\nután')).toBe('szöveg után');
  });
});

describe('markdown — word/char count', () => {
  it('szót számol jelölés nélkül', () => {
    expect(wordCount('# Cím\n\nEz **három** szó.')).toBe(4); // Cím, Ez, három, szó.
  });

  it('üres/whitespace → 0', () => {
    expect(wordCount('   \n\n')).toBe(0);
    expect(charCount('')).toBe(0);
  });

  it('a link URL-je nem számít bele, a szövege igen', () => {
    expect(wordCount('lásd [a dokumentumot](https://example.com/very/long/url)')).toBe(3);
  });
});

describe('markdown — readingTimeMin', () => {
  it('0 szó → 0 perc', () => {
    expect(readingTimeMin(0)).toBe(0);
  });
  it('kevés szó → legalább 1 perc', () => {
    expect(readingTimeMin(10)).toBe(1);
  });
  it('200 szó/perc alapból', () => {
    expect(readingTimeMin(500)).toBe(3); // ceil(500/200)=3
    expect(readingTimeMin(600, 300)).toBe(2);
  });
});

describe('markdown — extractOutline', () => {
  it('a heading-fát adja szinttel és sor-indexszel', () => {
    const md = '# Könyv\n\nbevezető\n\n## 1. fejezet\n\nszöveg\n\n### alfejezet\n\n## 2. fejezet';
    expect(extractOutline(md)).toEqual([
      { level: 1, text: 'Könyv', line: 0 },
      { level: 2, text: '1. fejezet', line: 4 },
      { level: 3, text: 'alfejezet', line: 8 },
      { level: 2, text: '2. fejezet', line: 10 },
    ]);
  });

  it('a kódblokkon belüli #-et NEM veszi headingnek', () => {
    const md = '# Valódi\n\n```\n# ez kód\n```\n\n## Szintén valódi';
    expect(extractOutline(md).map((o) => o.text)).toEqual(['Valódi', 'Szintén valódi']);
  });
});
