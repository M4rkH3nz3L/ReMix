process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const media = require('../media');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(media);
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

describe('media domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof media).toBe('function');
  });

  test('POST /captions fájl nélkül → 400', async () => {
    const res = await fetch(base + '/captions', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /waveform fájl nélkül → 400', async () => {
    const res = await fetch(base + '/waveform', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
