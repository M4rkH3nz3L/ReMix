// 🔁 2026-11-14: a szerveres hang-könyvtár Pro — a lista böngészhető, a fájl letöltése hitelesítés + Pro nélkül nem
// (valódi Express-app és HTTP; a könyvtár-listát kiváltjuk, a guard a valódi)
const http = require('http');
const path = require('path');
const express = require('express');

jest.mock('./notify', () => ({ adminClient: () => null }));
jest.mock('./sfx', () => ({
  listLibrary: async () => [{ id: 'song1', name: 'Dal', kind: 'music', duration: 8, bpm: 120, file: require('path').join(__dirname, 'package.json') }],
}));

let server;
let base;
beforeAll(async () => {
  delete process.env.ALLOW_INSECURE_DEV;
  const app = express();
  app.use(require('./routes/library'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

test('a lista hitelesítés nélkül is böngészhető', async () => {
  const r = await fetch(`${base}/music`);
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.tracks.map((t) => t.id)).toEqual(['song1']);
  expect(path.basename(body.tracks[0].url)).toBe('file');
});

test('a fájl letöltése hitelesítés nélkül 401 (Pro kell)', async () => {
  const r = await fetch(`${base}/music/song1/file`);
  expect(r.status).toBe(401);
});
