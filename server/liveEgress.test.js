// 💰 F3 — egress költségkontroll segédeinek tesztjei (liveEgress.js).
const { countActiveEgress, sweepUserStale, stopStale, intEnv, egressMinutes } = require('./liveEgress');

/** Láncolható + thenable Supabase-builder mock, ami `result`-ra oldódik. */
function mockSb(result) {
  const builder = {};
  for (const m of ['select', 'eq', 'lt', 'update', 'insert', 'order', 'maybeSingle']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.then = (onFulfilled) => onFulfilled(result);
  return { from: jest.fn(() => builder), _builder: builder };
}

describe('egressMinutes (renderMinutes-könyveléshez)', () => {
  test('két ISO-időpont perc-különbsége', () => {
    expect(egressMinutes('2026-10-06T12:00:00Z', '2026-10-06T12:30:00Z')).toBe(30);
    expect(egressMinutes('2026-10-06T12:00:00Z', '2026-10-06T12:00:45Z')).toBeCloseTo(0.75);
  });
  test('rossz / fordított / nulla input → 0', () => {
    expect(egressMinutes('rossz', '2026-10-06T12:30:00Z')).toBe(0);
    expect(egressMinutes('2026-10-06T12:30:00Z', '2026-10-06T12:00:00Z')).toBe(0); // fordított
    expect(egressMinutes('2026-10-06T12:00:00Z', '2026-10-06T12:00:00Z')).toBe(0); // azonos
  });
});

describe('intEnv', () => {
  test('parse-olja a pozitív egészet', () => {
    process.env.__TEST_EGRESS_N = '3';
    expect(intEnv('__TEST_EGRESS_N', 1)).toBe(3);
    delete process.env.__TEST_EGRESS_N;
  });
  test('default, ha hiányzik / nem pozitív', () => {
    delete process.env.__TEST_EGRESS_N;
    expect(intEnv('__TEST_EGRESS_N', 7)).toBe(7);
    process.env.__TEST_EGRESS_N = '0';
    expect(intEnv('__TEST_EGRESS_N', 7)).toBe(7);
    process.env.__TEST_EGRESS_N = 'abc';
    expect(intEnv('__TEST_EGRESS_N', 7)).toBe(7);
    delete process.env.__TEST_EGRESS_N;
  });
});

describe('countActiveEgress', () => {
  test('visszaadja a count-ot', async () => {
    const sb = mockSb({ count: 2, error: null });
    expect(await countActiveEgress(sb, 'u1')).toBe(2);
    expect(sb.from).toHaveBeenCalledWith('live_egress');
  });
  test('0, ha count null de nincs hiba', async () => {
    const sb = mockSb({ count: null, error: null });
    expect(await countActiveEgress(sb, 'u1')).toBe(0);
  });
  test('-1 hibánál (pl. tábla hiányzik → degradál)', async () => {
    const sb = mockSb({ count: null, error: { message: 'relation does not exist' } });
    expect(await countActiveEgress(sb, 'u1')).toBe(-1);
  });
  test('-1, ha nincs sb', async () => {
    expect(await countActiveEgress(null, 'u1')).toBe(-1);
  });
});

describe('stopStale', () => {
  test('minden sorra stopEgress + folytat, ha egy dob', async () => {
    const client = {
      stopEgress: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('már nincs')) // LiveKit-oldalon már leállt
        .mockResolvedValueOnce(undefined),
    };
    const sb = mockSb({ error: null });
    const rows = [{ egress_id: 'e1' }, { egress_id: 'e2' }, { egress_id: 'e3' }];
    const n = await stopStale(sb, client, rows, '2026-10-04T00:00:00Z');
    expect(n).toBe(3);
    expect(client.stopEgress).toHaveBeenCalledTimes(3);
    // mindháromra megtörtént a 'stopped' jelölés (update) is
    expect(sb._builder.update).toHaveBeenCalledTimes(3);
  });
  test('üres lista → 0', async () => {
    const client = { stopEgress: jest.fn() };
    expect(await stopStale(mockSb({ error: null }), client, [], 'iso')).toBe(0);
    expect(client.stopEgress).not.toHaveBeenCalled();
  });
});

describe('sweepUserStale', () => {
  test('leállítja a lejárt sorokat + visszaadja a számot', async () => {
    const client = { stopEgress: jest.fn().mockResolvedValue(undefined) };
    const sb = mockSb({ data: [{ egress_id: 'old1' }, { egress_id: 'old2' }], error: null });
    const n = await sweepUserStale(sb, client, 'u1', 240, Date.UTC(2026, 9, 4, 12, 0, 0));
    expect(n).toBe(2);
    expect(client.stopEgress).toHaveBeenCalledWith('old1');
    expect(client.stopEgress).toHaveBeenCalledWith('old2');
    // a cutoff szűrés bekerült a lekérdezésbe
    expect(sb._builder.lt).toHaveBeenCalledWith('started_at', expect.any(String));
  });
  test('0, ha nincs sb vagy client', async () => {
    expect(await sweepUserStale(null, {}, 'u1', 240, 0)).toBe(0);
    expect(await sweepUserStale(mockSb({ data: [], error: null }), null, 'u1', 240, 0)).toBe(0);
  });
  test('0 lekérdezési hibánál (degradál)', async () => {
    const client = { stopEgress: jest.fn() };
    const sb = mockSb({ data: null, error: { message: 'no table' } });
    expect(await sweepUserStale(sb, client, 'u1', 240, 0)).toBe(0);
    expect(client.stopEgress).not.toHaveBeenCalled();
  });
});
