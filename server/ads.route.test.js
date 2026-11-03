// 🎬 GET /ads/ssv (C2.2): valódi Express-app és HTTP; az aláírás egy saját P-256 kulccsal készül,
// a Google kulcslistáját és a service-klienst kiváltjuk. Csak érvényes aláírásra hív jóváírást.
const crypto = require('crypto');
const http = require('http');
const express = require('express');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const mockPem = publicKey.export({ type: 'spki', format: 'pem' });
const mockRpc = jest.fn(async () => ({ data: { status: 'granted', cents: 2 }, error: null }));
jest.mock('./notify', () => ({ adminClient: () => ({ rpc: (...a) => mockRpc(...a) }) }));
jest.mock('./admobSsv', () => {
  const real = jest.requireActual('./admobSsv');
  return { ...real, verifierKeys: async () => ({ 42: mockPem }) };
});

const websafe = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function query(fields) {
  const msg = new URLSearchParams(fields).toString();
  return `${msg}&signature=${websafe(crypto.sign('sha256', Buffer.from(msg), privateKey))}&key_id=42`;
}

let server;
let base;
beforeAll(async () => {
  const app = express();
  app.use(require('./routes/ads'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => mockRpc.mockClear());

const fields = { ad_unit: 'u1', reward_amount: '1', transaction_id: 'tx-1', user_id: 'a1000000-0000-0000-0000-000000000001' };

test('érvényes SSV → grant_ad_reward a user és a tranzakció azonosítójával', async () => {
  const r = await fetch(`${base}/ads/ssv?${query(fields)}`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ status: 'granted', cents: 2 });
  expect(mockRpc).toHaveBeenCalledWith('grant_ad_reward', { p_user: fields.user_id, p_transaction: 'tx-1', p_ad_unit: 'u1' });
});

test('hamisított user_id → 401, nincs jóváírás', async () => {
  const q = query(fields).replace('a1000000', 'b1000000');
  const r = await fetch(`${base}/ads/ssv?${q}`);
  expect(r.status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('aláírás nélkül → 400', async () => {
  const r = await fetch(`${base}/ads/ssv?user_id=x&transaction_id=y`);
  expect(r.status).toBe(400);
  expect(mockRpc).not.toHaveBeenCalled();
});
