// 🩹 PRO-LIVE L14/L16 — beragadt sessionök + egress-egyeztetés a LiveKit valós állapotával
const { reconcileLive } = require('./liveEgress');

/** táblánként konfigurálható, láncolható Supabase-mock; a hívásokat naplózza */
function mockSb(tables) {
  const calls = [];
  const from = (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const b = {};
    for (const m of ['select', 'eq', 'lt', 'update', 'maybeSingle']) {
      b[m] = (...args) => {
        q.ops.push([m, ...args]);
        return b;
      };
    }
    b.then = (ok) => ok(tables[table](q));
    return b;
  };
  return { from, calls };
}

test('a heartbeat nélküli sessiont lezárja; a véget ért egress sorát zárja; az árva egresst leállítja', async () => {
  const stopped = [];
  const sb = mockSb({
    live_sessions: (q) => {
      if (q.ops.some(([m]) => m === 'update')) return { data: [{ id: 'ghost' }], error: null };
      const id = q.ops.find(([m, c]) => m === 'eq' && c === 'id')?.[2];
      return { data: { status: id === 'room-ended' ? 'ended' : 'live' }, error: null };
    },
    live_egress: (q) => {
      if (q.ops.some(([m]) => m === 'update')) return { data: null, error: null };
      return {
        data: [
          { egress_id: 'eg-done', room: 'room-live' },
          { egress_id: 'eg-orphan', room: 'room-ended' },
          { egress_id: 'eg-ok', room: 'room-live' },
        ],
        error: null,
      };
    },
  });
  const client = {
    listEgress: async ({ egressId }) => [{ egressId, status: egressId === 'eg-done' ? 3 : 1 }],
    stopEgress: async (id) => stopped.push(id),
  };
  const r = await reconcileLive(Date.parse('2026-10-31T12:00:00Z'), { sb, client });
  expect(r).toEqual({ endedSessions: 1, closedEgress: 1, stoppedEgress: 1 });
  expect(stopped).toEqual(['eg-orphan']);
});

test('ha a LiveKit nem válaszol, nem dönt (nem zár le futó egresst)', async () => {
  const sb = mockSb({
    live_sessions: () => ({ data: [], error: null }),
    live_egress: () => ({ data: [{ egress_id: 'eg', room: 'r' }], error: null }),
  });
  const client = { listEgress: async () => { throw new Error('down'); }, stopEgress: async () => {} };
  expect(await reconcileLive(Date.now(), { sb, client })).toEqual({ endedSessions: 0, closedEgress: 0, stoppedEgress: 0 });
});
