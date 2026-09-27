import {
  addAsset,
  addTag,
  addToCollection,
  addVersion,
  assetKindFromProject,
  assetsByKind,
  assetsInProject,
  clearUsage,
  createCollection,
  deleteCollection,
  emptyLibrary,
  filterAssets,
  findDuplicates,
  findMissing,
  ingestProjectAssets,
  rateAsset,
  recordUsage,
  removeAsset,
  removeTag,
  searchAssets,
  toggleFavorite,
  usageOf,
} from '@/lib/assetLibrary';
import type { Project } from '@/types/project';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

const seed = () => {
  let lib = emptyLibrary(T0);
  lib = addAsset(lib, { kind: 'music', name: 'Neon Intro', uri: 'a://1', tags: ['intro', 'edm'], hash: 'h1' }, T0);
  lib = addAsset(lib, { kind: 'photo', name: 'Kutya a parkban', uri: 'a://2', tags: ['dog'], hash: 'h2' }, T0);
  lib = addAsset(lib, { kind: 'graphic', name: 'H3nz3L logo', uri: 'a://3', tags: ['brand'], hash: 'h3' }, T0);
  return lib;
};

describe('assetLibrary — add / remove / dedup', () => {
  it('felvesz egy assetet első verzióval', () => {
    const lib = addAsset(emptyLibrary(T0), { kind: 'music', name: 'x', uri: 'u', hash: 'h' }, T0);
    expect(lib.assets).toHaveLength(1);
    expect(lib.assets[0]).toMatchObject({ kind: 'music', name: 'x', uri: 'u', hash: 'h', rating: 0, favorite: false });
    expect(lib.assets[0].versions).toHaveLength(1);
    expect(lib.assets[0].versions[0].uri).toBe('u');
  });

  it('azonos hash-t NEM duplikál', () => {
    let lib = addAsset(emptyLibrary(T0), { kind: 'music', name: 'x', uri: 'u', hash: 'h' }, T0);
    lib = addAsset(lib, { kind: 'music', name: 'x-copy', uri: 'u2', hash: 'h' }, T1);
    expect(lib.assets).toHaveLength(1);
  });

  it('removeAsset töröl; ismeretlen id-re nincs változás', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    expect(removeAsset(lib, 'nope', T1)).toBe(lib);
    lib = removeAsset(lib, id, T1);
    expect(lib.assets).toHaveLength(2);
  });

  it('immutábilis — az eredeti könyvtár nem változik', () => {
    const base = emptyLibrary(T0);
    const lib = addAsset(base, { kind: 'music', name: 'x', uri: 'u' }, T0);
    expect(base.assets).toHaveLength(0);
    expect(lib).not.toBe(base);
  });
});

describe('assetLibrary — favorite / rating / tags', () => {
  it('toggleFavorite kapcsol', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    lib = toggleFavorite(lib, id, T1);
    expect(lib.assets[0].favorite).toBe(true);
    lib = toggleFavorite(lib, id, T1);
    expect(lib.assets[0].favorite).toBe(false);
  });

  it('rateAsset 0–5 közé vág', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    lib = rateAsset(lib, id, 9, T1);
    expect(lib.assets[0].rating).toBe(5);
    lib = rateAsset(lib, id, -3, T1);
    expect(lib.assets[0].rating).toBe(0);
  });

  it('addTag nem duplikál, removeTag töröl, üres tag no-op', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    lib = addTag(lib, id, 'intro', T1); // már megvan
    expect(lib.assets[0].tags).toEqual(['intro', 'edm']);
    expect(addTag(lib, id, '  ', T1)).toBe(lib);
    lib = addTag(lib, id, 'hook', T1);
    expect(lib.assets[0].tags).toContain('hook');
    lib = removeTag(lib, id, 'edm', T1);
    expect(lib.assets[0].tags).not.toContain('edm');
  });
});

describe('assetLibrary — kollekciók', () => {
  it('létrehoz, hozzáad, töröl kollekciót és tisztítja az asset-hivatkozást', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    const { library, id: colId } = createCollection(lib, 'Kedvencek', T1);
    lib = library;
    expect(lib.collections).toHaveLength(1);
    lib = addToCollection(lib, id, colId, T1);
    expect(lib.assets[0].collections).toContain(colId);
    // nem létező kollekcióhoz nem enged hozzáadni
    expect(addToCollection(lib, id, 'nope', T1)).toBe(lib);
    lib = deleteCollection(lib, colId, T1);
    expect(lib.collections).toHaveLength(0);
    expect(lib.assets[0].collections).not.toContain(colId);
  });
});

describe('assetLibrary — verziók', () => {
  it('addVersion frissíti az aktuális uri-t és listázza a verziókat', () => {
    let lib = addAsset(emptyLibrary(T0), { kind: 'graphic', name: 'logo', uri: 'v1', hash: 'h' }, T0);
    const id = lib.assets[0].id;
    lib = addVersion(lib, id, { uri: 'v2', label: 'sötét', hash: 'h2' }, T1);
    expect(lib.assets[0].uri).toBe('v2');
    expect(lib.assets[0].hash).toBe('h2');
    expect(lib.assets[0].versions).toHaveLength(2);
    expect(lib.assets[0].versions[1].label).toBe('sötét');
  });
});

describe('assetLibrary — usage („hol használtam?")', () => {
  it('recordUsage / usageOf / assetsInProject / clearUsage', () => {
    let lib = seed();
    const logo = lib.assets.find((a) => a.name === 'H3nz3L logo')!;
    lib = recordUsage(lib, logo.id, 'proj-A', T1);
    lib = recordUsage(lib, logo.id, 'proj-B', T1);
    lib = recordUsage(lib, logo.id, 'proj-A', T1); // idempotens
    expect(usageOf(lib, logo.id)).toEqual(['proj-A', 'proj-B']);
    expect(assetsInProject(lib, 'proj-A').map((a) => a.name)).toEqual(['H3nz3L logo']);
    lib = clearUsage(lib, 'proj-A', T1);
    expect(usageOf(lib, logo.id)).toEqual(['proj-B']);
  });
});

describe('assetLibrary — szűrés / keresés / csoportosítás', () => {
  it('filterAssets kind + tag + query szerint', () => {
    const lib = seed();
    expect(filterAssets(lib, { kind: 'photo' })).toHaveLength(1);
    expect(filterAssets(lib, { tag: 'brand' })).toHaveLength(1);
    expect(filterAssets(lib, { query: 'kutya' }).map((a) => a.name)).toEqual(['Kutya a parkban']);
  });

  it('filterAssets favorite + minRating', () => {
    let lib = seed();
    const id = lib.assets[0].id;
    lib = toggleFavorite(lib, id, T1);
    lib = rateAsset(lib, id, 4, T1);
    expect(filterAssets(lib, { favorite: true })).toHaveLength(1);
    expect(filterAssets(lib, { minRating: 4 })).toHaveLength(1);
    expect(filterAssets(lib, { minRating: 5 })).toHaveLength(0);
  });

  it('searchAssets rangsorol (pontos név-egyezés elöl)', () => {
    const lib = seed();
    const hits = searchAssets(lib, 'logo');
    expect(hits[0].asset.name).toBe('H3nz3L logo');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('searchAssets üres lekérdezésre üres', () => {
    expect(searchAssets(seed(), '   ')).toEqual([]);
  });

  it('assetsByKind típusonként csoportosít', () => {
    const g = assetsByKind(seed());
    expect(g.music).toHaveLength(1);
    expect(g.photo).toHaveLength(1);
    expect(g.graphic).toHaveLength(1);
  });
});

describe('assetLibrary — duplikátum + hiányzó', () => {
  it('findDuplicates hash-csoportokat ad (min. 2)', () => {
    let lib = emptyLibrary(T0);
    lib = addAsset(lib, { kind: 'photo', name: 'A', uri: 'a', hash: 'dup' }, T0);
    // a dedup miatt hash-t megkerülünk: manuálisan második azonos-hash asset
    // (addAsset kiszűrné) → külön hash-eket használunk, majd egyet átírunk teszt-célra
    lib = addAsset(lib, { kind: 'photo', name: 'B', uri: 'b', hash: 'dup2' }, T0);
    lib = { ...lib, assets: lib.assets.map((x) => (x.name === 'B' ? { ...x, hash: 'dup' } : x)) };
    const groups = findDuplicates(lib);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('findMissing a nem létező uri-kat adja', () => {
    const lib = seed();
    const present = new Set(['a://1', 'a://3']);
    const missing = findMissing(lib, (uri) => present.has(uri));
    expect(missing.map((a) => a.name)).toEqual(['Kutya a parkban']);
  });
});

describe('assetLibrary — projekt-bridge', () => {
  const mkProject = (): Project =>
    ({
      id: 'proj-1',
      name: 'teszt',
      aspectRatio: '9:16',
      tracks: [],
      assets: [
        { id: 'a1', kind: 'video', uri: 'v://1', provider: 'local', name: 'klip', hash: 'ph1', favorite: true, tags: ['keep'] },
        { id: 'a2', kind: 'audio', uri: 'm://1', provider: 'library', name: 'zene', hash: 'ph2', rating: 5 },
      ],
      createdAt: T0,
      updatedAt: T0,
      schemaVersion: 6,
    }) as unknown as Project;

  it('assetKindFromProject leképez', () => {
    expect(assetKindFromProject({ kind: 'video' })).toBe('video');
    expect(assetKindFromProject({ kind: 'audio' })).toBe('music');
    expect(assetKindFromProject({ kind: 'image' })).toBe('photo');
  });

  it('ingestProjectAssets behúzza az asseteket usage-gel és metaadattal', () => {
    const lib = ingestProjectAssets(emptyLibrary(T0), mkProject(), T0);
    expect(lib.assets).toHaveLength(2);
    const video = lib.assets.find((a) => a.name === 'klip')!;
    expect(video.kind).toBe('video');
    expect(video.usage).toEqual(['proj-1']);
    expect(video.favorite).toBe(true);
    expect(video.tags).toContain('keep');
    const music = lib.assets.find((a) => a.name === 'zene')!;
    expect(music.kind).toBe('music');
    expect(music.rating).toBe(5);
  });

  it('kétszeri ingest nem duplikál, de a usage megmarad', () => {
    let lib = ingestProjectAssets(emptyLibrary(T0), mkProject(), T0);
    lib = ingestProjectAssets(lib, mkProject(), T1);
    expect(lib.assets).toHaveLength(2);
    expect(usageOf(lib, lib.assets[0].id)).toEqual(['proj-1']);
  });
});
