// 🔌 Integrációs teszt az analysis domain-routerre (01-api-architecture §01.1).
// Determinisztikus mező-/fájl-hiány 400-ak, külső ffmpeg/AI nélkül.

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const analysis = require('../analysis');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(analysis);
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

describe('analysis domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof analysis).toBe('function');
  });

  test('POST /scenes fájl nélkül → 400 (hiányzó médiafájl)', async () => {
    const res = await fetch(base + '/scenes', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /track fájl nélkül (proOnly, INSECURE_DEV átenged) → 400', async () => {
    const res = await fetch(base + '/track', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /vision/query üres törzs → 400', async () => {
    const res = await fetch(base + '/vision/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const b = await res.json().catch(() => null);
    expect(b && typeof b.error).toBe('string');
  });
});
