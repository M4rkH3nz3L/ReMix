// 🔌 Integrációs teszt a storage domain-routerre (01-api-architecture §01.1).
// A router minimális Express-appon; determinisztikus válaszok külső tárhely nélkül.

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const storage = require('../storage');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(storage);
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

describe('storage domain-router (e2e)', () => {
  test('a router betölthető (express-middleware)', () => {
    expect(typeof storage).toBe('function');
  });

  test('GET /storage/connected userId nélkül → 401', async () => {
    const res = await fetch(base + '/storage/connected');
    expect(res.status).toBe(401);
  });

  test('POST /storage/connect érvénytelen típus (ftp) → 400', async () => {
    const res = await fetch(base + '/storage/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', type: 'ftp' }),
    });
    expect(res.status).toBe(400);
    const b = await res.json().catch(() => null);
    expect(b && typeof b.error).toBe('string');
  });

  test('GET /storage/sources userId nélkül → 200 { sources: [] } (user=[], nincs globális config)', async () => {
    const res = await fetch(base + '/storage/sources');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(Array.isArray(b.sources)).toBe(true);
  });
});
