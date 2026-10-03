const { eraseCooldownElapsed, storagePrefixes, listAllObjects } = require('./accountErase');

describe('accountErase — eraseCooldownElapsed (gating)', () => {
  const now = 1_700_000_000_000; // fix "most"
  const daysAgo = (d) => now - d * 24 * 3600 * 1000;

  it('nincs soft-delete (null/undefined) → NEM törölhető', () => {
    expect(eraseCooldownElapsed(null, now, 14)).toBe(false);
    expect(eraseCooldownElapsed(undefined, now, 14)).toBe(false);
  });

  it('friss soft-delete (1 napja, 14 cooldown) → még NEM', () => {
    expect(eraseCooldownElapsed(new Date(daysAgo(1)).toISOString(), now, 14)).toBe(false);
  });

  it('cooldown letelt (20 napja) → törölhető', () => {
    expect(eraseCooldownElapsed(new Date(daysAgo(20)).toISOString(), now, 14)).toBe(true);
  });

  it('pontosan a határon (14 nap) → törölhető', () => {
    expect(eraseCooldownElapsed(daysAgo(14), now, 14)).toBe(true);
  });

  it('érvénytelen dátum → false (fail-safe)', () => {
    expect(eraseCooldownElapsed('nem-datum', now, 14)).toBe(false);
  });
});

describe('accountErase — storagePrefixes', () => {
  it('projekt-id-nként egy mappa-prefix; üres/rossz kiszűrve', () => {
    expect(storagePrefixes(['p1', 'p2'])).toEqual(['p1/', 'p2/']);
    expect(storagePrefixes(['p1', '', null, undefined, 3])).toEqual(['p1/']);
    expect(storagePrefixes(null)).toEqual([]);
  });
});

describe('accountErase — listAllObjects (rekurzív, best-effort)', () => {
  const fakeStorage = {
    list: async (p) => {
      if (p === 'proj1') {
        return { data: [{ name: 'video', id: null }, { name: 'top.json', id: 'f0' }] };
      }
      if (p === 'proj1/video') {
        return { data: [{ name: 'a.mp4', id: 'f1' }, { name: 'b.mp4', id: 'f2' }] };
      }
      return { data: [] };
    },
  };

  it('a mappákba rekurzál, a fájlok teljes útját adja', async () => {
    const out = await listAllObjects(fakeStorage, 'proj1/');
    expect(out).toEqual(
      expect.arrayContaining(['proj1/video/a.mp4', 'proj1/video/b.mp4', 'proj1/top.json'])
    );
    expect(out).toHaveLength(3);
  });

  it('hiba/üres storage → [] (sosem dob)', async () => {
    const throwing = { list: async () => { throw new Error('storage le'); } };
    await expect(listAllObjects(throwing, 'x/')).resolves.toEqual([]);
    await expect(listAllObjects(null, 'x/')).resolves.toEqual([]);
  });
});
