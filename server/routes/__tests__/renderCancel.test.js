// 🛑 Regresszió (refactor-roadmap 3.): a POST /render/:id/cancel valódi HTTP-n át. Az idegen felhő-jobot
// a tulaj-ellenőrzés ELŐTT nem szabad megszakítani (eddig a cancelRenderJob előbb futott → a várakozó
// job kikerült a sorból, a futónál abort-flag, és csak utána jött a 404).
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const mockEvents = [];
const mockQueue = { jobs: {}, cancelled: [] };
jest.mock('../../security/auditLog', () => ({ securityEvent: (type, d) => mockEvents.push([type, d]) }));
jest.mock('../../auth', () => ({
  ...jest.requireActual('../../auth'),
  // a tesztben a token maga a user-id (Supabase nélkül)
  verifyToken: async (t) => (t ? { ok: true, user: { id: t } } : { ok: false }),
}));
jest.mock('../../queue', () => ({
  ...jest.requireActual('../../queue'),
  queueEnabled: () => true,
  getRenderJob: async (id) => mockQueue.jobs[id] || null,
  cancelRenderJob: async (id) => {
    mockQueue.cancelled.push(id);
    const j = mockQueue.jobs[id];
    return j
      ? { found: true, userId: j.userId, removed: j.state !== 'active', active: j.state === 'active' }
      : { found: false, userId: null, removed: false, active: false };
  },
}));

const express = require('express');

/** egy friss routerrel (az INSECURE_DEV betöltéskor rögzül) indított szerver */
function startServer(insecureDev) {
  process.env.ALLOW_INSECURE_DEV = insecureDev ? '1' : '';
  let router;
  jest.isolateModules(() => {
    router = require('../render');
  });
  const app = express();
  app.use(router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const cancel = (base, id, uid) =>
  fetch(`${base}/render/${id}/cancel`, { method: 'POST', headers: uid ? { authorization: `Bearer ${uid}` } : {} });

beforeEach(() => {
  mockEvents.length = 0;
  mockQueue.cancelled = [];
  mockQueue.jobs = {
    qWait: { userId: 'u-tulaj', state: 'waiting' },
    qActive: { userId: 'u-tulaj', state: 'active' },
    qNoOwner: { userId: null, state: 'waiting' },
  };
});

describe('POST /render/:id/cancel — prod (tulaj-ellenőrzés a megszakítás ELŐTT)', () => {
  let srv;
  beforeAll(async () => {
    srv = await startServer(false);
  });
  afterAll(() => new Promise((r) => srv.server.close(() => r())));

  test('támadás: idegen user a más várakozó felhő-jobját akarja törölni → 404, a cancelRenderJob NEM fut', async () => {
    const res = await cancel(srv.base, 'qWait', 'u-tamado');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Ismeretlen job.' });
    expect(mockQueue.cancelled).toEqual([]);
    expect(mockEvents).toEqual([['render.denied', { actor: 'u-tamado', target: 'qWait', meta: { owner: 'u-tulaj' } }]]);
  });

  test('támadás: idegen user a más FUTÓ felhő-jobját akarja leállítani → 404, nincs abort-flag', async () => {
    const res = await cancel(srv.base, 'qActive', 'u-tamado');
    expect(res.status).toBe(404);
    expect(mockQueue.cancelled).toEqual([]);
  });

  test('token nélkül sem lehet megszakítani → 404, érintetlen job', async () => {
    const res = await cancel(srv.base, 'qWait', null);
    expect(res.status).toBe(404);
    expect(mockQueue.cancelled).toEqual([]);
  });

  test('a tulaj a saját várakozó jobját megszakítja (removed), a futót abort-jelzéssel', async () => {
    const r1 = await cancel(srv.base, 'qWait', 'u-tulaj');
    expect(await r1.json()).toEqual({ ok: true, mode: 'queue', removed: true, active: false });
    const r2 = await cancel(srv.base, 'qActive', 'u-tulaj');
    expect(await r2.json()).toEqual({ ok: true, mode: 'queue', removed: false, active: true });
    expect(mockQueue.cancelled).toEqual(['qWait', 'qActive']);
    expect(mockEvents).toEqual([]);
  });

  test('tulajdonos nélküli job prod-ban senkinek sem szakítható meg → 404', async () => {
    const res = await cancel(srv.base, 'qNoOwner', 'u-tulaj');
    expect(res.status).toBe(404);
    expect(mockQueue.cancelled).toEqual([]);
  });

  test('ismeretlen job: idempotens „none”, a megszakítás nem fut', async () => {
    const res = await cancel(srv.base, 'nincs', 'u-tulaj');
    expect(await res.json()).toEqual({ ok: true, mode: 'none' });
    expect(mockQueue.cancelled).toEqual([]);
  });
});

describe('POST /render/:id/cancel — insecure-dev', () => {
  let srv;
  beforeAll(async () => {
    srv = await startServer(true);
  });
  afterAll(() => new Promise((r) => srv.server.close(() => r())));

  test('tulajdonos nélküli job insecure-dev-ben megszakítható', async () => {
    const res = await cancel(srv.base, 'qNoOwner', null);
    expect(await res.json()).toEqual({ ok: true, mode: 'queue', removed: true, active: false });
    expect(mockQueue.cancelled).toEqual(['qNoOwner']);
  });

  test('idegen tulajdonú jobot insecure-dev-ben sem lehet megszakítani', async () => {
    const res = await cancel(srv.base, 'qWait', 'u-tamado');
    expect(res.status).toBe(404);
    expect(mockQueue.cancelled).toEqual([]);
  });
});
