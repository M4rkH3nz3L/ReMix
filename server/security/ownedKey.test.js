// 🔐 I46 — ownedMediaKey: a tár-kulcs mindig a hitelesített user prefixe alatt van.
const { ownedMediaKey } = require('./ownedKey');

describe('ownedMediaKey — tulajdonos-rész', () => {
  it('hiányzó uid → anon prefix', () => {
    expect(ownedMediaKey(null, 'p1', 'a.png')).toBe('u/anon/p1/a.png');
    expect(ownedMediaKey(undefined, '', 'a.png')).toBe('u/anon/a.png');
    expect(ownedMediaKey('', 'p1', 'a.png')).toBe('u/anon/p1/a.png');
  });

  it('csak tiltott karakterből álló uid → anon (nem üres prefix)', () => {
    expect(ownedMediaKey('../..', 'p1', 'a.png')).toBe('u/anon/p1/a.png');
  });

  it('a uid 64 karakterre vágva, a nem-szó karakterek kiszűrve', () => {
    const long = 'x'.repeat(80);
    expect(ownedMediaKey(long, null, 'a')).toBe(`u/${'x'.repeat(64)}/a`);
    expect(ownedMediaKey('a/b c', null, 'a')).toBe('u/abc/a');
  });
});

describe('ownedMediaKey — projekt-rész', () => {
  it('null / undefined projekt → projekt nélküli kulcs', () => {
    expect(ownedMediaKey('u1', null, 'x.png')).toBe('u/u1/x.png');
    expect(ownedMediaKey('u1', undefined, 'x.png')).toBe('u/u1/x.png');
  });

  it('csak tiltott karakterből álló projekt-ID → projekt nélküli kulcs (nem lép ki a prefixből)', () => {
    expect(ownedMediaKey('u1', '../', 'x.png')).toBe('u/u1/x.png');
  });

  it('a projekt-ID 64 karakterre vágva', () => {
    expect(ownedMediaKey('u1', 'p'.repeat(70), 'x')).toBe(`u/u1/${'p'.repeat(64)}/x`);
  });
});
