// 🔌 Integrációs teszt a billing + live domain-routerekre (01-api-architecture §01.1).
// A routereket minimális Express-appra mountoljuk, és determinisztikus — külső
// szolgáltatás nélküli — válaszokat ellenőrzünk (a handlerek 503/403 precedenciája
// a config hiányában; az egress-layout a __dirname-fix helyességét igazolja).

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
// FONTOS: nincs ALLOW_DEV_BILLING / LIVEKIT_* / RC_WEBHOOK_AUTH → a 403/503 utak.

// guards → billing → notify → expo-server-sdk (ESM) kimockolása (lásd http.test.js).
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const billing = require('../billing');
const live = require('../live');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(billing);
app.use(live);
app.use(errorHandler);

let server;
let base;

beforeAll((done) => {
  server = app.listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('billing + live domain-routerek (e2e)', () => {
  test('mindkét router express-middleware (betölthető)', () => {
    expect(typeof billing).toBe('function');
    expect(typeof live).toBe('function');
  });

  test('POST /billing/activate — dev-billing KI (ALLOW_DEV_BILLING hiányzik) → 403', async () => {
    const { status, json } = await post('/billing/activate', {});
    expect(status).toBe(403);
    expect(typeof json.error).toBe('string');
  });

  test('POST /billing/revenuecat — nincs RC_WEBHOOK_AUTH → 503', async () => {
    const { status } = await post('/billing/revenuecat', {});
    expect(status).toBe(503);
  });

  test('POST /live/token — nincs LiveKit-config → 503 (a requireAuth INSECURE_DEV-ben átenged)', async () => {
    const { status } = await post('/live/token', { room: 'teszt-room' });
    expect(status).toBe(503);
  });

  test('GET /live/egress-layout → 200 (a __dirname-fix a server/egressLayout.html-re mutat)', async () => {
    const res = await fetch(base + '/live/egress-layout');
    expect(res.status).toBe(200);
  });
});
