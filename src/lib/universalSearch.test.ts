import {
  assetToDoc,
  groupByScope,
  parseQuery,
  projectToDoc,
  resolveTimeRange,
  scoreDoc,
  scoreDocFuzzy,
  search,
  suggest,
  type SearchDoc,
} from '@/lib/universalSearch';
import { addAsset, emptyLibrary } from '@/lib/assetLibrary';
import type { Project } from '@/types/project';

const NOW = '2026-09-27T12:00:00.000Z';

describe('universalSearch — parseQuery (NL szűrők)', () => {
  it('„félbehagyott projektek" → project scope + unfinished, nincs keresőszó', () => {
    const p = parseQuery('félbehagyott projektek');
    expect(p.scopes).toEqual(['project']);
    expect(p.status).toBe('unfinished');
    expect(p.terms).toEqual([]);
  });

  it('„tavalyi nyári fotók" → photo scope + last-year + summer', () => {
    const p = parseQuery('tavalyi nyári fotók');
    expect(p.scopes).toEqual(['photo']);
    expect(p.timeHints).toEqual(expect.arrayContaining(['last-year', 'summer']));
    expect(p.terms).toEqual([]);
  });

  it('bigram „this year" felismerés + maradék keresőszó', () => {
    const p = parseQuery('this year vlog');
    expect(p.timeHints).toContain('this-year');
    expect(p.terms).toEqual(['vlog']);
  });

  it('scope/idő szavakat NEM tartja meg keresőszónak, a valódit igen', () => {
    const p = parseQuery('zenék neon');
    expect(p.scopes).toEqual(['music']);
    expect(p.terms).toEqual(['neon']);
  });
});

describe('universalSearch — resolveTimeRange (determinisztikus, UTC)', () => {
  it('last-year + summer az ELŐZŐ év nyarára szűkít', () => {
    const r = resolveTimeRange(['last-year', 'summer'], NOW);
    expect(r.from).toBe('2025-06-01T00:00:00.000Z');
    expect(r.to).toBe('2025-09-01T00:00:00.000Z');
  });

  it('today a nap kezdetétől most+1-ig', () => {
    const r = resolveTimeRange(['today'], NOW);
    expect(r.from).toBe('2026-09-27T00:00:00.000Z');
    expect(new Date(r.to!).getTime()).toBe(new Date(NOW).getTime() + 1);
  });

  it('üres hint → üres tartomány', () => {
    expect(resolveTimeRange([], NOW)).toEqual({});
  });
});

describe('universalSearch — scoreDoc', () => {
  const doc: SearchDoc = { id: '1', scope: 'asset', title: 'Neon logo', keywords: ['brand'] };

  it('nincs keresőszó → 1 (recency dönt)', () => {
    expect(scoreDoc(doc, [])).toBe(1);
  });

  it('cím-egyezés magasabb pontot ad, mint csak keyword-egyezés', () => {
    const titleHit = scoreDoc(doc, ['neon']);
    const kwHit = scoreDoc(doc, ['brand']);
    expect(titleHit).toBeGreaterThan(kwHit);
  });
});

describe('universalSearch — search (végponti viselkedés)', () => {
  const docs: SearchDoc[] = [
    { id: 'p1', scope: 'project', title: 'Nyári vlog', updatedAt: '2026-09-01T00:00:00.000Z', meta: { published: false } },
    { id: 'p2', scope: 'project', title: 'Kész film', updatedAt: '2026-08-01T00:00:00.000Z', meta: { published: true } },
    { id: 'a1', scope: 'music', title: 'Neon Intro', keywords: ['edm'], updatedAt: '2026-09-20T00:00:00.000Z' },
    { id: 'a2', scope: 'photo', title: 'Kutya a parkban', keywords: ['dog'], updatedAt: '2025-07-15T00:00:00.000Z' },
    { id: 'a3', scope: 'photo', title: 'Téli táj', updatedAt: '2025-12-10T00:00:00.000Z' },
    { id: 'a4', scope: 'asset', title: 'Neon logo', keywords: ['brand'], updatedAt: '2026-06-10T00:00:00.000Z' },
  ];

  it('„félbehagyott projektek" csak a nem-publikált projektet adja', () => {
    const r = search(docs, 'félbehagyott projektek', { now: NOW });
    expect(r.map((x) => x.id)).toEqual(['p1']);
  });

  it('„zenék" a music scope-ot adja, recency szerint', () => {
    const r = search(docs, 'zenék', { now: NOW });
    expect(r.map((x) => x.id)).toEqual(['a1']);
  });

  it('„tavalyi nyári fotók" a tavalyi nyári fotóra szűkít (téli kizárva)', () => {
    const r = search(docs, 'tavalyi nyári fotók', { now: NOW });
    expect(r.map((x) => x.id)).toEqual(['a2']);
  });

  it('szabad-szavas: „neon" a zene-intrót ÉS a logót is megtalálja (score-rendezve)', () => {
    const r = search(docs, 'neon', { now: NOW });
    expect(r.map((x) => x.id).sort()).toEqual(['a1', 'a4']);
  });

  it('részleges NL-egyezés: „neon logóm" visszaadja a Neon logót', () => {
    const r = search(docs, 'neon logóm', { now: NOW });
    expect(r.map((x) => x.id)).toContain('a4');
  });

  it('scope-only lekérdezés recency szerint rendez', () => {
    const r = search(docs, 'projektek', { now: NOW });
    expect(r.map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  it('opts.scopes tovább szűkít', () => {
    const r = search(docs, 'neon', { now: NOW, scopes: ['music'] });
    expect(r.map((x) => x.id)).toEqual(['a1']);
  });

  it('limit érvényesül', () => {
    const r = search(docs, 'projektek', { now: NOW, limit: 1 });
    expect(r).toHaveLength(1);
  });
});

describe('universalSearch — adapterek', () => {
  it('projectToDoc scope=project, published a rendered alapján', () => {
    const p = { id: 'p', name: 'Vlog', kind: 'video', aspectRatio: '9:16', updatedAt: NOW, createdAt: NOW } as unknown as Project;
    const doc = projectToDoc(p);
    expect(doc.scope).toBe('project');
    expect(doc.title).toBe('Vlog');
    expect(doc.meta?.published).toBe(false);
  });

  it('assetToDoc a zenét „music" scope-ba, a grafikát „asset"-be teszi', () => {
    let lib = emptyLibrary(NOW);
    lib = addAsset(lib, { kind: 'music', name: 'zene', uri: 'u' }, NOW);
    lib = addAsset(lib, { kind: 'graphic', name: 'logo', uri: 'u2' }, NOW);
    const [music, graphic] = lib.assets;
    expect(assetToDoc(music).scope).toBe('music');
    expect(assetToDoc(graphic).scope).toBe('asset');
  });

  it('adapterekből épített index kereshető', () => {
    let lib = emptyLibrary(NOW);
    lib = addAsset(lib, { kind: 'photo', name: 'Naplemente', tags: ['sunset'], uri: 'u' }, NOW);
    const docs = lib.assets.map(assetToDoc);
    const r = search(docs, 'naplemente', { now: NOW });
    expect(r).toHaveLength(1);
  });
});

describe('universalSearch — scoreDocFuzzy (typo-tolerancia)', () => {
  const doc: SearchDoc = { id: '1', scope: 'asset', title: 'Neon logo', keywords: ['brand'] };

  it('pontos egyezésre AZONOS a scoreDoc-kal (szuperhalmaz)', () => {
    expect(scoreDocFuzzy(doc, ['neon'])).toBe(scoreDoc(doc, ['neon']));
    expect(scoreDocFuzzy(doc, ['brand'])).toBe(scoreDoc(doc, ['brand']));
  });

  it('típushibás token részleges kreditet kap (0 < fuzzy < pontos)', () => {
    const exact = scoreDocFuzzy(doc, ['neon']);
    const typo = scoreDocFuzzy(doc, ['neom']); // 1 betű elütés
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeLessThan(exact);
  });

  it('túl rövid (≤3) tokenre nincs fuzzy (zaj-védelem)', () => {
    expect(scoreDocFuzzy(doc, ['xon'])).toBe(0); // nem substring + túl rövid a fuzzyhoz
  });
});

describe('universalSearch — search fuzzy-fallback', () => {
  const docs: SearchDoc[] = [
    { id: 'p1', scope: 'project', title: 'Nyári vlog', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'a1', scope: 'music', title: 'Neon Intro', keywords: ['edm'], updatedAt: '2026-09-20T00:00:00.000Z' },
    { id: 'a4', scope: 'asset', title: 'Neon logo', keywords: ['brand'], updatedAt: '2026-06-10T00:00:00.000Z' },
  ];

  it('típushibás lekérdezés („neom") a fallbackkel megtalálja a találatokat', () => {
    const r = search(docs, 'neom', { now: NOW });
    expect(r.map((x) => x.id).sort()).toEqual(['a1', 'a4']);
  });

  it('fuzzy:false kikapcsolja a fallbacket → típushibára nincs találat', () => {
    expect(search(docs, 'neom', { now: NOW, fuzzy: false })).toEqual([]);
  });

  it('pontos-találatos lekérdezést NEM változtat meg (fallback nem fut)', () => {
    const r = search(docs, 'neon', { now: NOW });
    expect(r.map((x) => x.id).sort()).toEqual(['a1', 'a4']);
  });
});

describe('universalSearch — suggest (autocomplete)', () => {
  const docs: SearchDoc[] = [
    { id: '1', scope: 'project', title: 'Nyári vlog', keywords: ['summer'] },
    { id: '2', scope: 'music', title: 'Neon Intro', keywords: ['edm', 'neon'] },
    { id: '3', scope: 'asset', title: 'Neon logo', keywords: ['brand'] },
  ];

  it('cím-prefix + kulcsszó-prefix, pontszám szerint rangsorolva', () => {
    expect(suggest(docs, 'neo')).toEqual(['Neon Intro', 'Neon logo', 'neon']);
  });

  it('üres/whitespace prefix → nincs javaslat', () => {
    expect(suggest(docs, '')).toEqual([]);
    expect(suggest(docs, '   ')).toEqual([]);
  });

  it('típushibás prefix is javasol (fuzzy-prefix a címre)', () => {
    expect(suggest(docs, 'neom')).toEqual(['Neon Intro', 'Neon logo']);
  });

  it('limit érvényesül', () => {
    expect(suggest(docs, 'neo', { limit: 1 })).toEqual(['Neon Intro']);
  });
});

describe('universalSearch — groupByScope', () => {
  it('scope-onként csoportosít', () => {
    const docs: SearchDoc[] = [
      { id: '1', scope: 'project', title: 'a' },
      { id: '2', scope: 'music', title: 'b' },
      { id: '3', scope: 'project', title: 'c' },
    ];
    const g = groupByScope(search(docs, '', {}));
    expect(g.project).toHaveLength(2);
    expect(g.music).toHaveLength(1);
  });
});
