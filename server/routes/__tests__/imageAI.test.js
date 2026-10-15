// 🔌 Integrációs teszt az imageAI domain-routerre (01-api-architecture §01.1).

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const imageAI = require('../imageAI');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(imageAI);
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

describe('imageAI domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof imageAI).toBe('function');
  });

  test('GET /sky/presets → 200 { presets }', async () => {
    const res = await fetch(base + '/sky/presets');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(Array.isArray(b.presets)).toBe(true);
  });

  test('POST /faces fájl nélkül (proOnly, INSECURE_DEV átenged) → 400', async () => {
    const res = await fetch(base + '/faces', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /upscale fájl nélkül → 400', async () => {
    const res = await fetch(base + '/upscale', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
