// 🔌 Integrációs teszt az imageTools domain-routerre (01-api-architecture §01.1).
// Determinisztikus válaszok külső ONNX/render nélkül.

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const imageTools = require('../imageTools');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(imageTools);
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

describe('imageTools domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof imageTools).toBe('function');
  });

  test('GET /stickers3d → 200 (lista)', async () => {
    const res = await fetch(base + '/stickers3d');
    expect(res.status).toBe(200);
    const b = await res.json().catch(() => null);
    expect(b).toBeTruthy();
  });

  test('GET /depth/:id/:name hibás id → 400', async () => {
    const res = await fetch(base + '/depth/nem-hex/bg.png');
    expect(res.status).toBe(400);
  });

  test('POST /imagedoc doc nélkül → 400', async () => {
    const res = await fetch(base + '/imagedoc', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
