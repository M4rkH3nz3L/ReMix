// 🔌 Integrációs teszt a render domain-routerre (01-api-architecture §01.1).
// Determinisztikus válaszok Redis/S3 nélkül (queueEnabled=false → local-ág).

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const render = require('../render');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(render);
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

describe('render domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof render).toBe('function');
  });

  test('GET /render/queue → 200 (REDIS nélkül enabled:false)', async () => {
    const res = await fetch(base + '/render/queue');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.enabled).toBe(false);
  });

  test('POST /render project nélkül → 400', async () => {
    const res = await fetch(base + '/render', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('GET /render/:id ismeretlen id → 404', async () => {
    const res = await fetch(base + '/render/nincs-ilyen-job');
    expect(res.status).toBe(404);
  });
});
