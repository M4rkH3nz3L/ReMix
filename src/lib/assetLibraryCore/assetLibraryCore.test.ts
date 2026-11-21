import { addAsset, addTag, addToCollection, clearUsage, emptyLibrary, rateAsset, recordUsage, removeAsset, renameAsset } from '@/lib/assetLibraryCore/reducer';
import { filterAssets, findMissing, searchAssets } from '@/lib/assetLibraryCore/queries';
import { assetKindFromProject } from '@/lib/assetLibraryCore/projectBridge';
import * as assetLibrary from '@/lib/assetLibrary';

/** 🗂️ Az asset-könyvtár magja (REFACTOR: a src/lib/assetLibrary.ts-ből bontva) — a mai viselkedés rögzítve. */

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const seed = () => addAsset(emptyLibrary(T0), { kind: 'photo', name: ' Neon logó ', uri: 'file:///a', tags: ['neon'], hash: 'h1' }, T0);

describe('reducer — változatlan bemenetre UGYANAZ a referencia', () => {
  it('ismeretlen id-ra a rename / usage / kollekció nem másol', () => {
    const lib = seed();
    expect(renameAsset(lib, 'nope', 'x', T1)).toBe(lib);
    expect(recordUsage(lib, 'nope', 'p1', T1)).toBe(lib);
    expect(clearUsage(lib, 'p1', T1)).toBe(lib);
    expect(removeAsset(lib, 'nope', T1)).toBe(lib);
    expect(addToCollection(lib, lib.assets[0].id, 'col_nope', T1)).toBe(lib);
    expect(addTag(lib, lib.assets[0].id, '   ', T1)).toBe(lib);
  });

  it('hash-egyezésnél az addAsset nem duplikál', () => {
    const lib = seed();
    expect(addAsset(lib, { kind: 'video', name: 'más', uri: 'file:///b', hash: 'h1' }, T1)).toBe(lib);
  });

  it('a név trimelve, üres → „asset”; a rating 0–5 közé kerekítve', () => {
    const lib = seed();
    const a = lib.assets[0];
    expect(a.name).toBe('Neon logó');
    expect(addAsset(emptyLibrary(T0), { kind: 'font', name: '  ', uri: 'u' }, T0).assets[0].name).toBe('asset');
    expect(rateAsset(lib, a.id, 2.5, T1).assets[0].rating).toBe(3);
    expect(rateAsset(lib, a.id, 9, T1).assets[0].rating).toBe(5);
    expect(rateAsset(lib, a.id, -2, T1).assets[0].rating).toBe(0);
  });

  it('a módosított asset és a könyvtár updatedAt-je a megadott időre áll', () => {
    const lib = seed();
    const next = renameAsset(lib, lib.assets[0].id, 'Új', T1);
    expect(next.updatedAt).toBe(T1);
    expect(next.assets[0].updatedAt).toBe(T1);
  });
});

describe('queries — szűrés / keresés / hiányzó média', () => {
  it('a szabad-szavas szűrő az ékezet-normalizált tartalmazásra is illik', () => {
    const lib = seed();
    expect(filterAssets(lib, { query: 'LOGO' }).length).toBe(1);
    expect(filterAssets(lib, { query: 'zzz' }).length).toBe(0);
    expect(filterAssets(lib, { minRating: 1 }).length).toBe(0);
  });

  it('üres lekérdezés → nincs találat; a név-tartalmazás +0,5, a pontos tag +0,3 boost', () => {
    const lib = seed();
    expect(searchAssets(lib, '   ')).toEqual([]);
    const [hit] = searchAssets(lib, 'neon');
    expect(hit.asset.id).toBe(lib.assets[0].id);
    expect(hit.score).toBeGreaterThanOrEqual(0.8);
  });

  it('findMissing a predikátum szerint', () => {
    const lib = seed();
    expect(findMissing(lib, () => true)).toEqual([]);
    expect(findMissing(lib, () => false).map((a) => a.uri)).toEqual(['file:///a']);
  });
});

describe('projectBridge — projekt-Asset.kind → AssetKind', () => {
  it('video → video, audio → music, minden más → photo', () => {
    expect(assetKindFromProject({ kind: 'video' })).toBe('video');
    expect(assetKindFromProject({ kind: 'audio' })).toBe('music');
    expect(assetKindFromProject({ kind: 'image' })).toBe('photo');
  });
});

describe('assetLibrary barrel — a publikus felület', () => {
  it('a futásidejű exportok listája változatlan', () => {
    expect(Object.keys(assetLibrary).sort()).toEqual(
      [
        'ASSET_KINDS',
        'ASSET_KIND_ICON',
        'addAsset',
        'addTag',
        'addToCollection',
        'addVersion',
        'assetKindFromProject',
        'assetsByKind',
        'assetsInProject',
        'clearUsage',
        'createCollection',
        'deleteCollection',
        'emptyLibrary',
        'filterAssets',
        'findDuplicates',
        'findMissing',
        'ingestProjectAssets',
        'rateAsset',
        'recordUsage',
        'removeAsset',
        'removeFromCollection',
        'removeTag',
        'renameAsset',
        'searchAssets',
        'toggleFavorite',
        'usageOf',
      ].sort()
    );
  });
});
