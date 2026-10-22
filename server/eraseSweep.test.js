// 🗑️ GDPR hard-erase sweep (03-production §03.4) — a selector + az orchestrator
// hálózat nélkül, injektált fake sb/erase-szel. (A destruktív storage/auth staging-e2e.)
const {
  eligibleForErase,
  eraseAccount,
  sweepExpiredErasures,
  eraseSweepEnabled,
  runEraseSweepOnce,
} = require('./eraseSweep');

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000; // fix „most"

describe('eligibleForErase — csak a lejárt-cooldownú soft-delete', () => {
  test('lejárt (>14 nap) → benne; friss (<14 nap) → ki; null deleted_at → ki', () => {
    const profiles = [
      { id: 'a', deleted_at: new Date(NOW - 15 * DAY).toISOString() }, // lejárt → erase
      { id: 'b', deleted_at: new Date(NOW - 1 * DAY).toISOString() }, // friss → marad
      { id: 'c', deleted_at: null }, // nincs soft-delete → marad
      { id: 'd', deleted_at: new Date(NOW - 14 * DAY).toISOString() }, // pont 14 nap → erase
    ];
    expect(eligibleForErase(profiles, NOW)).toEqual(['a', 'd']);
  });

  test('id nélküli / rossz dátumú sor kihagyva; nem-tömb → []', () => {
    expect(eligibleForErase([{ deleted_at: new Date(NOW - 20 * DAY).toISOString() }], NOW)).toEqual([]);
    expect(eligibleForErase([{ id: 'x', deleted_at: 'nem-datum' }], NOW)).toEqual([]);
    expect(eligibleForErase(null, NOW)).toEqual([]);
  });
});

/** fake service_role-kliens: a profiles-lekérés visszaadja a megadott sorokat. */
function fakeSb(profiles, { profilesError = null } = {}) {
  return {
    from: () => ({
      select: () => ({
        not: () => Promise.resolve({ data: profiles, error: profilesError }),
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}) }) },
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  };
}

describe('sweepExpiredErasures — orchestrator (injektált erase)', () => {
  test('a lejártakat törli, a frisset nem; a count-ok stimmelnek', async () => {
    const profiles = [
      { id: 'a', deleted_at: new Date(NOW - 15 * DAY).toISOString() },
      { id: 'b', deleted_at: new Date(NOW - 1 * DAY).toISOString() },
      { id: 'e', deleted_at: new Date(NOW - 30 * DAY).toISOString() },
    ];
    const erasedUids = [];
    const erase = async (_sb, uid) => {
      erasedUids.push(uid);
      return { purgedObjects: 3 };
    };
    const r = await sweepExpiredErasures({ sb: fakeSb(profiles), now: NOW, erase });
    expect(r).toEqual({ eligible: 2, erased: 2, failed: 0 });
    expect(erasedUids.sort()).toEqual(['a', 'e']);
  });

  test('egy fiók törlése hibázik → failed számol, a többi megy tovább', async () => {
    const profiles = [
      { id: 'a', deleted_at: new Date(NOW - 15 * DAY).toISOString() },
      { id: 'e', deleted_at: new Date(NOW - 30 * DAY).toISOString() },
    ];
    const erase = async (_sb, uid) => {
      if (uid === 'a') throw new Error('auth-user törlés sikertelen');
      return { purgedObjects: 0 };
    };
    const r = await sweepExpiredErasures({ sb: fakeSb(profiles), now: NOW, erase });
    expect(r).toEqual({ eligible: 2, erased: 1, failed: 1 });
  });

  test('nincs sb → no-op (0/0/0)', async () => {
    expect(await sweepExpiredErasures({ sb: null })).toEqual({ eligible: 0, erased: 0, failed: 0 });
  });

  test('profiles-lekérés hibája → dob (a cron 1-es exit-tel jelez)', async () => {
    await expect(
      sweepExpiredErasures({ sb: fakeSb([], { profilesError: { message: 'db le' } }), now: NOW })
    ).rejects.toThrow(/profiles/);
  });
});

describe('eraseAccount — per-fiók hard-erase (fake sb)', () => {
  test('üres storage + sikeres deleteUser → purgedObjects 0', async () => {
    const r = await eraseAccount(fakeSb([]), 'uid-1');
    expect(r).toEqual({ purgedObjects: 0 });
  });

  test('deleteUser hiba → dob', async () => {
    const sb = fakeSb([]);
    sb.auth.admin.deleteUser = async () => ({ error: { message: 'nincs jogosultság' } });
    await expect(eraseAccount(sb, 'uid-1')).rejects.toThrow(/auth-user törlés/);
  });
});

describe('eraseSweepEnabled — a napi sweep/CLI kapuja', () => {
  test('CSAK ALLOW_ACCOUNT_ERASE=1 ÉS van service_role-admin → true', () => {
    expect(eraseSweepEnabled({ ALLOW_ACCOUNT_ERASE: '1' }, true)).toBe(true);
    expect(eraseSweepEnabled({ ALLOW_ACCOUNT_ERASE: '1' }, false)).toBe(false); // nincs admin-kliens
    expect(eraseSweepEnabled({ ALLOW_ACCOUNT_ERASE: '0' }, true)).toBe(false); // gate ki
    expect(eraseSweepEnabled({}, true)).toBe(false); // nincs env → alapból OFF (prod-biztonság)
  });
});

describe('runEraseSweepOnce — scheduler/CLI közös belépő', () => {
  test('lefuttatja a sweepet + strukturált összegzést logol', async () => {
    const logs = [];
    const sweep = async () => ({ eligible: 2, erased: 1, failed: 1 });
    const logger = { info: (msg, meta) => logs.push({ msg, meta }) };
    const s = await runEraseSweepOnce({ sb: {}, sweep, logger });
    expect(s).toEqual({ eligible: 2, erased: 1, failed: 1 });
    expect(logs).toEqual([{ msg: 'erase-sweep', meta: { eligible: 2, erased: 1, failed: 1 } }]);
  });

  test('a sweep hiányzó mezőit 0-ra tölti', async () => {
    const s = await runEraseSweepOnce({ sb: {}, sweep: async () => ({}), logger: { info: () => {} } });
    expect(s).toEqual({ eligible: 0, erased: 0, failed: 0 });
  });
});
