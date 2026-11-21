// 🎬 A server/routes/renderLib/ regressziós tesztjei (REFACTOR): a routes/render.js bontása után a route-tábla
// (útvonal, sorrend, middleware-lánc, névtelen kezelő), a közös job-tár és a job-kezelők tulaj-ellenőrzésének
// JELENLEGI viselkedését rögzítik.
process.env.ALLOW_INSECURE_DEV = '';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));
const mockEvents = [];
const mockQueue = { enabled: false, jobs: {}, cancelled: [] };
jest.mock('../../security/auditLog', () => ({ securityEvent: (type, d) => mockEvents.push([type, d]) }));
jest.mock('../../queue', () => ({
  ...jest.requireActual('../../queue'),
  queueEnabled: () => mockQueue.enabled,
  getRenderJob: async (id) => mockQueue.jobs[id] || null,
  cancelRenderJob: async (id) => {
    mockQueue.cancelled.push(id);
    const j = mockQueue.jobs[id];
    return j ? { found: true, userId: j.userId, removed: true, active: false } : { found: false, userId: null, removed: false, active: false };
  },
}));

const router = require('../render');
const { jobs } = require('./jobStore');
const { renderStatusHandler, renderFileHandler, renderCancelHandler } = require('./jobHandlers');
const { renderSubmitHandler } = require('./submitHandler');
const { proxyHandler, collectHandler } = require('./packageHandlers');
const { renderQueueHandler } = require('./queueHandler');

function fakeRes() {
  const res = { code: 200, body: undefined, file: undefined };
  res.status = (c) => ((res.code = c), res);
  res.json = (b) => ((res.body = b), res);
  res.sendFile = (f) => ((res.file = f), res);
  return res;
}
const req = (id, uid) => ({ params: { id }, user: uid ? { id: uid } : null, query: {}, headers: {} });

beforeEach(() => {
  jobs.clear();
  mockEvents.length = 0;
  mockQueue.enabled = false;
  mockQueue.jobs = {};
  mockQueue.cancelled = [];
});

describe('route-tábla (routes/render.js)', () => {
  test('ugyanazok az útvonalak, ugyanabban a sorrendben, ugyanazzal a middleware-lánccal; a kezelő névtelen', () => {
    const table = router.stack.map((l) => [Object.keys(l.route.methods)[0], l.route.path, l.route.stack.map((s) => `${s.name}/${s.handle.length}`).join(' ')]);
    const upload = 'requireAuth/3 <anonymous>/3 multerMiddleware/3 <anonymous>/2';
    expect(table).toEqual([
      ['post', '/render', 'requireAuth/3 requirePaid/3 multerMiddleware/3 <anonymous>/2'],
      ['post', '/proxy', upload],
      ['post', '/collect', upload],
      ['get', '/render/queue', 'requireAuth/3 <anonymous>/2'],
      ['get', '/render/:id', 'renderJobAuth/3 <anonymous>/2'],
      ['get', '/render/:id/file', 'renderJobAuth/3 <anonymous>/2'],
      ['post', '/render/:id/cancel', 'renderJobAuth/3 <anonymous>/2'],
    ]);
  });

  test('a /render/queue a /render/:id ELŐTT (különben a „queue” job-azonosítóként menne)', () => {
    const paths = router.stack.map((l) => l.route.path);
    expect(paths.indexOf('/render/queue')).toBeLessThan(paths.indexOf('/render/:id'));
  });

  test('a kezelők névtelenek és (req, res) aritásúak', () => {
    for (const h of [renderSubmitHandler, proxyHandler, collectHandler, renderQueueHandler, renderStatusHandler, renderFileHandler, renderCancelHandler]) {
      expect(h.name).toBe('');
      expect(h.length).toBe(2);
    }
  });
});

describe('job-tár (renderLib/jobStore.js)', () => {
  test('a set időbélyeget tesz a jobra (a TTL-söprés ebből dolgozik), a többi mezőt megtartja', () => {
    jobs.set('x', { state: 'done', userId: 'u1' });
    expect(jobs.get('x')).toEqual({ state: 'done', userId: 'u1', updatedAt: expect.any(Number) });
  });
});

describe('job-kezelők — tulaj-ellenőrzés (lokális job)', () => {
  test('saját job állapota látszik; idegenre és token nélkül 404 + biztonsági esemény', async () => {
    jobs.set('j1', { state: 'processing', progress: 0.5, userId: 'u1' });
    const own = fakeRes();
    await renderStatusHandler(req('j1', 'u1'), own);
    expect(own.body).toEqual({ state: 'processing', error: undefined, progress: 0.5, degraded: undefined });

    const other = fakeRes();
    await renderStatusHandler(req('j1', 'u2'), other);
    expect([other.code, other.body]).toEqual([404, { error: 'Ismeretlen job.' }]);
    const anon = fakeRes();
    await renderStatusHandler(req('j1', null), anon);
    expect(anon.code).toBe(404);
    expect(mockEvents).toEqual([
      ['render.denied', { actor: 'u2', target: 'j1', meta: { owner: 'u1' } }],
      ['render.denied', { actor: null, target: 'j1', meta: { owner: 'u1' } }],
    ]);
  });

  test('tulajdonos nélküli job prod-ban senkinek sem érhető el', async () => {
    jobs.set('j0', { state: 'done', file: '/x.mp4', userId: null });
    const res = fakeRes();
    await renderFileHandler(req('j0', 'u1'), res);
    expect([res.code, res.file]).toEqual([404, undefined]);
  });

  test('a letöltés csak kész jobra megy; a még futóra 404 „még nem készült el”', async () => {
    jobs.set('j2', { state: 'processing', userId: 'u1' });
    const res = fakeRes();
    await renderFileHandler(req('j2', 'u1'), res);
    expect([res.code, res.body]).toEqual([404, { error: 'A render még nem készült el.' }]);
    jobs.set('j3', { state: 'done', file: '/w/out.mp4', userId: 'u1' });
    const ok = fakeRes();
    await renderFileHandler(req('j3', 'u1'), ok);
    expect(ok.file).toBe('/w/out.mp4');
  });

  test('a megszakítás a saját lokális jobot abortálja; idegen jobot nem', async () => {
    const abort = jest.fn();
    jobs.set('j4', { state: 'processing', userId: 'u1', abort });
    const other = fakeRes();
    await renderCancelHandler(req('j4', 'u2'), other);
    expect([other.code, abort.mock.calls.length]).toEqual([404, 0]);
    const own = fakeRes();
    await renderCancelHandler(req('j4', 'u1'), own);
    expect([own.body, abort.mock.calls.length]).toEqual([{ ok: true, mode: 'local' }, 1]);
  });

  test('ismeretlen job: állapot 404, megszakítás idempotens „none”', async () => {
    const st = fakeRes();
    await renderStatusHandler(req('nincs', 'u1'), st);
    expect(st.code).toBe(404);
    const c = fakeRes();
    await renderCancelHandler(req('nincs', 'u1'), c);
    expect(c.body).toEqual({ ok: true, mode: 'none' });
  });
});

describe('job-kezelők — felhő-sor', () => {
  test('a sor-állapot leképezése: completed → done (degraded), failed → error, egyéb → processing', async () => {
    mockQueue.enabled = true;
    mockQueue.jobs = {
      a: { userId: 'u1', state: 'completed', progress: 100, returnvalue: { degraded: ['fx'] } },
      b: { userId: 'u1', state: 'failed', failedReason: 'boom' },
      c: { userId: 'u1', state: 'active', progress: 40 },
    };
    const out = [];
    for (const id of ['a', 'b', 'c']) {
      const res = fakeRes();
      await renderStatusHandler(req(id, 'u1'), res);
      out.push(res.body);
    }
    expect(out).toEqual([
      { state: 'done', progress: 1, error: undefined, degraded: ['fx'] },
      { state: 'error', progress: 0, error: 'boom', degraded: undefined },
      { state: 'processing', progress: 0.4, error: undefined, degraded: undefined },
    ]);
  });

  test('✅ JAVÍTVA: idegen sor-jobnál a tulaj-ellenőrzés a cancelRenderJob ELŐTT fut → 404, a job érintetlen', async () => {
    mockQueue.enabled = true;
    mockQueue.jobs = { q: { userId: 'u-masik', state: 'waiting' } };
    const res = fakeRes();
    await renderCancelHandler(req('q', 'u1'), res);
    expect(res.code).toBe(404);
    expect(mockQueue.cancelled).toEqual([]);
  });
});
