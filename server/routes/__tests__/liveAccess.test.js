// 🔐 PRO-LIVE L1/L9 — a live-token döntés a `live_sessions` sor ellen (prod-mód: nincs insecure-dev)
delete process.env.ALLOW_INSECURE_DEV;
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

let mockRows = {};
let mockFail = false;
jest.mock('../../notify', () => ({
  adminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col, id) => ({
          maybeSingle: async () => (mockFail ? { data: null, error: { message: 'db down' } } : { data: mockRows[id] ?? null, error: null }),
        }),
      }),
    }),
  }),
}));

const { resolveLiveAccess } = require('../live');

beforeEach(() => {
  mockFail = false;
  mockRows = { room1: { host_id: 'host', status: 'live' }, old: { host_id: 'host', status: 'ended' } };
});

test('a host publikálhat (kamera + adat), a néző csak néz', async () => {
  expect(await resolveLiveAccess('room1', 'host', true)).toMatchObject({ status: 200, canPublish: true, hostId: 'host' });
  expect(await resolveLiveAccess('room1', 'viewer', true)).toMatchObject({ status: 200, canPublish: false });
});

test('nem létező szoba → 404, befejezett adás → 410', async () => {
  expect((await resolveLiveAccess('nope', 'host', false)).status).toBe(404);
  expect((await resolveLiveAccess('old', 'host', true)).status).toBe(410);
});

test('DB-hiba prod-módban → 503 (nem enged tovább)', async () => {
  mockFail = true;
  expect((await resolveLiveAccess('room1', 'host', true)).status).toBe(503);
});
