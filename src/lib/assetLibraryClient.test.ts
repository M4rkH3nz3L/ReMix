import { addAsset, addTag, createCollection, emptyLibrary, rateAsset, recordUsage } from '@/lib/assetLibrary';
import { parseLibraryDoc } from '@/lib/assetLibraryClient';

const T0 = '2026-01-01T00:00:00.000Z';
const jsonRoundtrip = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

describe('assetLibraryClient — parseLibraryDoc', () => {
  it('round-trip: assetek + kollekciók + usage + verziók hiánytalanul', () => {
    let lib = emptyLibrary(T0);
    lib = addAsset(lib, { kind: 'music', name: 'Neon', uri: 'u', tags: ['edm'], hash: 'h', size: 10 }, T0);
    const id = lib.assets[0].id;
    lib = addTag(lib, id, 'intro', T0);
    lib = rateAsset(lib, id, 4, T0);
    lib = recordUsage(lib, id, 'p1', T0);
    const created = createCollection(lib, 'Kedvencek', T0);
    lib = created.library;
    expect(parseLibraryDoc(jsonRoundtrip(lib))).toEqual(lib);
  });

  it('hibás/hiányzó doc → üres könyvtár', () => {
    expect(parseLibraryDoc(null)).toEqual({ assets: [], collections: [], updatedAt: '' });
    expect(parseLibraryDoc({})).toEqual({ assets: [], collections: [], updatedAt: '' });
    expect(parseLibraryDoc({ assets: 5, collections: 'x' })).toEqual({ assets: [], collections: [], updatedAt: '' });
  });

  it('a hibás asseteket/kollekciókat kihagyja', () => {
    const doc = {
      updatedAt: T0,
      assets: [
        { id: 'ok', kind: 'photo', name: 'jó', uri: 'u', tags: [], collections: [], favorite: false, rating: 0, usage: [], versions: [], createdAt: T0, updatedAt: T0 },
        { id: 'x', kind: 'photo' }, // nincs name/uri
        { id: 'y', kind: 'ismeretlen', name: 'rossz kind', uri: 'u' },
      ],
      collections: [{ id: 'c', name: 'jó', createdAt: T0 }, { name: 'nincs id' }],
    };
    const lib = parseLibraryDoc(doc);
    expect(lib.assets).toHaveLength(1);
    expect(lib.assets[0].id).toBe('ok');
    expect(lib.collections).toHaveLength(1);
  });
});
