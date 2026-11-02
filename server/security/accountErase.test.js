const { eraseCooldownElapsed, purgeUserMedia } = require('./accountErase');

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

describe('purgeUserMedia — csak a saját napló (S7)', () => {
  /** valós sorrendet és lapozást utánzó napló: a szűrés a user_id-re a lekérdezésben történik */
  const ledger = (rows) => ({
    from: () => {
      const q = { uid: null };
      const api = {
        select: () => api,
        eq: (_c, v) => ((q.uid = v), api),
        order: () => api,
        range: async (a, b) => ({ data: rows.filter((r) => r.user_id === q.uid).slice(a, b + 1), error: null }),
      };
      return api;
    },
  });

  it('a támadó ugyanazzal a projekt-ID-val sem törölheti az áldozat fájlját', async () => {
    const rows = [
      { user_id: 'tamado', key: 'prj_aldozat/video/sajat.mp4' },
      { user_id: 'aldozat', key: 'prj_aldozat/video/aldozat.mp4' },
    ];
    const removed = [];
    await purgeUserMedia(ledger(rows), 'tamado', async (k) => removed.push(k));
    expect(removed).toEqual(['prj_aldozat/video/sajat.mp4']);
  });

  it('1000 fájl fölött is mindent töröl', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ user_id: 'u', key: `k${i}` }));
    const removed = [];
    const out = await purgeUserMedia(ledger(rows), 'u', async (k) => removed.push(k));
    expect(out).toEqual({ purged: 2345, failed: 0 });
    expect(new Set(removed).size).toBe(2345);
  });

  it('a profilkép és a projekt nélküli fájl is benne van', async () => {
    const rows = [{ user_id: 'u', key: 'profile/a.png' }, { user_id: 'u', key: 'media/b.png' }];
    const removed = [];
    await purgeUserMedia(ledger(rows), 'u', async (k) => removed.push(k));
    expect(removed).toEqual(['profile/a.png', 'media/b.png']);
  });

  it('a hibás fájl számolódik, a többi törlődik', async () => {
    const rows = [{ user_id: 'u', key: 'a' }, { user_id: 'u', key: 'b' }];
    const out = await purgeUserMedia(ledger(rows), 'u', async (k) => {
      if (k === 'a') throw new Error('x');
    });
    expect(out).toEqual({ purged: 1, failed: 1 });
  });

  it('a napló lekérési hibája megállít', async () => {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ error: { message: 'le' } }) }) }) }) }) };
    await expect(purgeUserMedia(sb, 'u', async () => {})).rejects.toThrow(/storage_objects/);
  });
});
