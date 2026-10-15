process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const externalMedia = require('../externalMedia');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(externalMedia);
app.use(errorHandler);

let server;
let base;
beforeAll((done) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done(); }); });
afterAll((done) => {
  server.close(done);
});

describe('externalMedia domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof externalMedia).toBe('function');
  });

  test('GET /tts/voices → 200 { available, voices }', async () => {
    const res = await fetch(base + '/tts/voices');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(Array.isArray(b.voices)).toBe(true);
  });

  test('POST /youtube üres törzs → hibastátusz (503 nincs-yt / 400 nincs-url, nem 200)', async () => {
    const res = await fetch(base + '/youtube', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
