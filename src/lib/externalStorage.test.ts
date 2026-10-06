import { parseConnectedProviders, parseStorageEntries } from '@/lib/externalStorage';

/**
 * 🛡️ Határ-validáció a külső tárhely worker-válaszaira (audit §12.1). Az őrök
 * SZŰRNEK, nem dobnak: a hibás/hiányos elem kiesik, a null/nem-objektum válasz
 * sem omlik — a jó adat megmarad.
 */
describe('parseConnectedProviders', () => {
  it('a jó provider átmegy, a hibás (nincs id/type) kiesik', () => {
    const out = parseConnectedProviders({
      providers: [
        { id: 'a', type: 'gdrive', label: 'Drive', status: 'ok', isDefault: true },
        { id: 'b', type: 'dropbox' }, // hiányos, de id+type megvan → default mezők
        { type: 'webdav' }, // nincs id → kiesik
        { id: 'c' }, // nincs type → kiesik
        'nem objektum', // kiesik
      ],
    });
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
    expect(out[0]).toEqual({ id: 'a', type: 'gdrive', label: 'Drive', status: 'ok', isDefault: true });
    // hiányzó mezők default-olnak (nem undefined)
    expect(out[1]).toEqual({ id: 'b', type: 'dropbox', label: '', status: '', isDefault: false });
  });

  it('null / nem-objektum / hiányzó providers → [] (nem omlik)', () => {
    expect(parseConnectedProviders(null)).toEqual([]);
    expect(parseConnectedProviders('x')).toEqual([]);
    expect(parseConnectedProviders([])).toEqual([]); // tömb nem record → []
    expect(parseConnectedProviders({})).toEqual([]);
    expect(parseConnectedProviders({ providers: 'nem tömb' })).toEqual([]);
  });

  it('a nem-boolean isDefault false-ra default-ol', () => {
    const out = parseConnectedProviders({ providers: [{ id: 'a', type: 's3', isDefault: 'igen' }] });
    expect(out[0].isDefault).toBe(false);
  });
});

describe('parseStorageEntries', () => {
  it('kötelező mezők (id/name/url/kind) + opcionális duration/size/path', () => {
    const out = parseStorageEntries({
      entries: [
        { id: '1', name: 'klip.mp4', url: 'u1', kind: 'video', duration: 12.5, size: 1024, path: '/a/b' },
        { id: '2', name: 'kép.jpg', url: 'u2', kind: 'image' }, // opcionálisok nélkül
      ],
    });
    expect(out).toEqual([
      { id: '1', name: 'klip.mp4', url: 'u1', kind: 'video', duration: 12.5, size: 1024, path: '/a/b' },
      { id: '2', name: 'kép.jpg', url: 'u2', kind: 'image' },
    ]);
  });

  it('érvénytelen kind / hiányzó url → az elem kiesik', () => {
    const out = parseStorageEntries({
      entries: [
        { id: '1', name: 'x', url: 'u', kind: 'pdf' }, // rossz kind
        { id: '2', name: 'y', kind: 'video' }, // nincs url
        { id: '3', name: 'z', url: 'u3', kind: 'audio' }, // jó
      ],
    });
    expect(out.map((e) => e.id)).toEqual(['3']);
  });

  it('negatív/NaN duration-t nem vesz át (finiteTime szűr)', () => {
    const out = parseStorageEntries({
      entries: [{ id: '1', name: 'x', url: 'u', kind: 'video', duration: -5, size: NaN }],
    });
    expect(out[0].duration).toBeUndefined();
    expect(out[0].size).toBeUndefined();
  });

  it('null / hiányzó entries → [] (nem omlik)', () => {
    expect(parseStorageEntries(null)).toEqual([]);
    expect(parseStorageEntries({})).toEqual([]);
    expect(parseStorageEntries({ entries: null })).toEqual([]);
  });
});
