process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const social = require('../social');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(social);
app.use(errorHandler);

let server;
let base;
beforeAll((done) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done(); }); });
afterAll((done) => {
  server.close(done);
});

describe('social domain-router (e2e)', () => {
  test('a router betölthető', () => {
    expect(typeof social).toBe('function');
  });

  test('POST /notify — nincs service_role (notifyAvailable=false) → 503', async () => {
    const res = await fetch(base + '/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });
});
