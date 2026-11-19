// 🗄️ Tárhely-kvóta (quota.js): a hiteles ellenőrzés a DB-ben fut (record_storage_object_for); itt a
// worker-oldali fordítást rögzítjük hamis service-klienssel — limit-túllépés → QuotaExceededError,
// service_role nélkül best-effort no-op, a bájtszám szanitizálása, a saját sor szűrése.
let mockSb = null;
jest.mock('./notify', () => ({ adminClient: () => mockSb }));
const { QuotaExceededError, quotaAvailable, usageFor, recordObject, wouldExceed, forgetObject, moveObject } = require('./quota');

/** hamis kliens: rögzíti a hívásokat; `rpcResult(name, args)` adja a választ */
function fakeSb(rpcResult = () => ({ data: null, error: null }), tableError = null) {
  const calls = [];
  const chain = (op, row) => {
    const filters = [];
    const q = {
      eq: (col, val) => {
        filters.push([col, val]);
        return filters.length === 3 ? Promise.resolve(record()) : q;
      },
    };
    const record = () => {
      calls.push([op, row ?? null, filters]);
      return { error: tableError };
    };
    return q;
  };
  return {
    calls,
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return rpcResult(name, args);
    },
    from: (table) => ({
      delete: () => chain(`delete:${table}`),
      update: (row) => chain(`update:${table}`, row),
    }),
  };
}

afterEach(() => {
  mockSb = null;
});

describe('service_role nélkül (dev): best-effort, semmi sem számol', () => {
  test('nincs kliens → nem elérhető, null-használat, nincs kivétel', async () => {
    expect(quotaAvailable()).toBe(false);
    await expect(usageFor('u1')).resolves.toBeNull();
    await expect(recordObject('u1', { key: 'k', bytes: 10 })).resolves.toBeNull();
    await expect(wouldExceed('u1', 10)).resolves.toEqual({ exceeded: false, usage: null });
    await expect(forgetObject('u1', 'renders', 'k')).resolves.toBeUndefined();
    await expect(moveObject('u1', 'renders', 'a', 'b')).resolves.toBeUndefined();
  });

  test('üres / szóköz user-id → nem kérdez a DB-től', async () => {
    mockSb = fakeSb();
    expect(quotaAvailable()).toBe(true);
    await expect(usageFor('  ')).resolves.toBeNull();
    await expect(recordObject('', { key: 'k', bytes: 1 })).resolves.toBeNull();
    await forgetObject(null, 'renders', 'k');
    await moveObject(undefined, 'renders', 'a', 'b');
    expect(mockSb.calls).toEqual([]);
  });
});

describe('usageFor', () => {
  test('a storage_usage_for RPC-t hívja a megtisztított id-vel', async () => {
    mockSb = fakeSb(() => ({ data: { used_bytes: 5, quota_bytes: 10 }, error: null }));
    await expect(usageFor(' u1 ')).resolves.toEqual({ used_bytes: 5, quota_bytes: 10 });
    expect(mockSb.calls).toEqual([['rpc', 'storage_usage_for', { p_user: 'u1' }]]);
  });

  test('DB-hiba → dob', async () => {
    mockSb = fakeSb(() => ({ data: null, error: { message: 'boom' } }));
    await expect(usageFor('u1')).rejects.toThrow('boom');
  });
});

describe('recordObject — atomikus ellenőrzés + beírás', () => {
  test('a paraméterek a DB-nek: alapértékek, a bájt egész és nem negatív', async () => {
    mockSb = fakeSb(() => ({ data: { used_bytes: 7 }, error: null }));
    await expect(recordObject('u1', { key: 'k1', bytes: '12.9' })).resolves.toEqual({ used_bytes: 7 });
    await recordObject('u1', { projectId: 'p', bucket: 'b', key: 'k2', bytes: -5, source: 'client' });
    await recordObject('u1', { key: 'k3', bytes: 'nem szám' });
    expect(mockSb.calls.map((c) => c[2])).toEqual([
      { p_user: 'u1', p_bucket: 'renders', p_key: 'k1', p_bytes: 12, p_project_id: null, p_source: 'server' },
      { p_user: 'u1', p_bucket: 'b', p_key: 'k2', p_bytes: 0, p_project_id: 'p', p_source: 'client' },
      { p_user: 'u1', p_bucket: 'renders', p_key: 'k3', p_bytes: 0, p_project_id: null, p_source: 'server' },
    ]);
  });

  test('quota_exceeded → QuotaExceededError a friss használattal', async () => {
    mockSb = fakeSb((name) =>
      name === 'record_storage_object_for'
        ? { data: null, error: { message: 'ERROR: Quota_Exceeded (P0001)' } }
        : { data: { used_bytes: 99, quota_bytes: 100 }, error: null });
    const err = await recordObject('u1', { key: 'k', bytes: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.name).toBe('QuotaExceededError');
    expect(err.message).toBe('quota_exceeded');
    expect(err.usage).toEqual({ used_bytes: 99, quota_bytes: 100 });
  });

  test('quota_exceeded, de a használat-lekérés is bukik → a hiba akkor is QuotaExceededError (usage: null)', async () => {
    mockSb = fakeSb((name) => (name === 'record_storage_object_for' ? { data: null, error: { message: 'quota_exceeded' } } : { data: null, error: { message: 'down' } }));
    const err = await recordObject('u1', { key: 'k', bytes: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.usage).toBeNull();
  });

  test('más DB-hiba → sima Error (nem kvóta-hiba)', async () => {
    mockSb = fakeSb(() => ({ data: null, error: { message: 'permission denied' } }));
    const err = await recordObject('u1', { key: 'k', bytes: 1 }).catch((e) => e);
    expect(err).not.toBeInstanceOf(QuotaExceededError);
    expect(err.message).toBe('permission denied');
  });

  test('a QuotaExceededError használat nélkül null-t visz', () => {
    expect(new QuotaExceededError().usage).toBeNull();
  });
});

describe('wouldExceed — gyors elő-ellenőrzés', () => {
  const withUsage = (usage) => fakeSb(() => ({ data: usage, error: null }));

  test.each([
    [{ used_bytes: 90, quota_bytes: 100 }, 10, false], // pont a határig: még belefér
    [{ used_bytes: 90, quota_bytes: 100 }, 11, true],
    [{ used_bytes: '50', quota_bytes: '100' }, '60', true], // szövegként érkező számok
    [{ used_bytes: 0, quota_bytes: 0 }, 0, false],
    [{ used_bytes: 100, quota_bytes: 100 }, -50, false], // negatív bejövő = 0
    [{}, 1, true], // hiányzó kvóta = 0
    [{ used_bytes: 5, quota_bytes: 10 }, 'x', false],
  ])('%j + %p → %p', async (usage, incoming, exceeded) => {
    mockSb = withUsage(usage);
    await expect(wouldExceed('u1', incoming)).resolves.toEqual({ exceeded, usage });
  });

  test('a használat-lekérés hibája → nem tilt (a hiteles kapu a recordObject)', async () => {
    mockSb = fakeSb(() => ({ data: null, error: { message: 'down' } }));
    await expect(wouldExceed('u1', 10)).resolves.toEqual({ exceeded: false, usage: null });
  });
});

describe('forgetObject / moveObject — csak a user SAJÁT sora', () => {
  test('törlés: user + bucket + key szűrővel', async () => {
    mockSb = fakeSb();
    await forgetObject(' u1 ', 'renders', 'k');
    expect(mockSb.calls).toEqual([['delete:storage_objects', null, [['user_id', 'u1'], ['bucket', 'renders'], ['key', 'k']]]]);
  });

  test('áthelyezés: csak a kulcs változik, a régi kulcsra szűr', async () => {
    mockSb = fakeSb();
    await moveObject('u1', 'renders', 'old', 'new');
    expect(mockSb.calls).toEqual([['update:storage_objects', { key: 'new' }, [['user_id', 'u1'], ['bucket', 'renders'], ['key', 'old']]]]);
  });

  test('DB-hiba → dob', async () => {
    mockSb = fakeSb(undefined, { message: 'rls' });
    await expect(forgetObject('u1', 'renders', 'k')).rejects.toThrow('rls');
    await expect(moveObject('u1', 'renders', 'a', 'b')).rejects.toThrow('rls');
  });
});
