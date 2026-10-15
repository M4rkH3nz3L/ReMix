process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const account = require('../account');
const wallet = require('../wallet');
const library = require('../library');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(account);
app.use(wallet);
app.use(library);
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

describe('account / wallet / library domain-routerek (e2e)', () => {
  test('mindhárom router betölthető', () => {
    expect(typeof account).toBe('function');
    expect(typeof wallet).toBe('function');
    expect(typeof library).toBe('function');
  });

  test('POST /account/erase — ALLOW_ACCOUNT_ERASE KI → hibastátusz (nem 200)', async () => {
    const res = await fetch(base + '/account/erase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('POST /wallet/payout üres/konfigurálatlan → hibastátusz (nem 200)', async () => {
    const res = await fetch(base + '/wallet/payout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('GET /library → 200 (média-tár lista)', async () => {
    const res = await fetch(base + '/library');
    expect(res.status).toBe(200);
  });

  test('GET /music → 200 (zene-lista)', async () => {
    const res = await fetch(base + '/music');
    expect(res.status).toBe(200);
  });
});
