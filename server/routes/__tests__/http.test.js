// 🔌 Integrációs teszt a refaktorált route-réteghez: a VALÓDI audioGen domain-
// routert egy minimális Express-appra mountoljuk, és HTTP-n át vizsgáljuk a teljes
// láncot (domain-router + guard + séma-validáció + egységes errorHandler).
// (01-api-architecture §01.1–§01.3)
//
// Miért nem a teljes index.js-t bootoljuk itt: az behúzza az `expo-server-sdk`-t,
// ami ESM, és a jest `server` projekt (nyers Node, transzform nélkül) nem tudja
// betölteni. A route-réteg így is e2e vizsgálható a router közvetlen mountolásával;
// hogy az index.js listen NÉLKÜL importálható és app-ot exportál, azt a
// `scripts/*-smoke`/runtime (`node -e require('./index')`) igazolja.

// A Pro/Paid-kaput dev-módba tesszük az import ELŐTT (a guards.js az auth INSECURE_DEV-
// jét importkor olvassa), hogy a paidOnly tokenkérés nélkül átengedjen.
process.env.ALLOW_INSECURE_DEV = '1';

// A guards → billing → notify lánc behúzza az `expo-server-sdk`-t (ESM), amit a
// jest `server` projekt (nyers Node, transzform nélkül) nem tud parszolni. A push-
// út nem része ennek a tesztnek (a paidOnly INSECURE_DEV-ben rövidre zár, a billing/
// notify kód NEM fut, csak importálódik), ezért kimockoljuk. A `server` projektnek
// nincs babel-hoisting → a jest.mock-ot KÉZZEL a require-ök ELÉ tesszük.
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const audioGen = require('../audioGen');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(audioGen);
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

async function postJson(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe('audioGen domain-router (e2e)', () => {
  test('a router betölthető és express-middleware (függvény)', () => {
    expect(typeof audioGen).toBe('function');
  });

  test('POST /synth üres notes → 400 { error, code:"validation", issues } (séma + errorHandler)', async () => {
    const { status, json } = await postJson('/synth', { notes: [] });
    expect(status).toBe(400);
    expect(typeof json.error).toBe('string');
    expect(json.code).toBe('validation');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues[0].path).toBe('notes');
  });

  test('POST /drums hiányzó hits → 400 issues', async () => {
    const { status, json } = await postJson('/drums', {});
    expect(status).toBe(400);
    expect(Array.isArray(json.issues)).toBe(true);
  });

  test('POST /synth érvénytelen JSON-törzs → 400 (egységes hibaalak, nem 500/HTML)', async () => {
    const res = await fetch(base + '/synth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nem valid json',
    });
    expect(res.status).toBe(400);
    const b = await res.json().catch(() => null);
    expect(b && typeof b.error).toBe('string');
  });

  test('ismeretlen route a routeren → 404 (nem matchel)', async () => {
    const res = await fetch(base + '/synth/nincs-ilyen');
    expect(res.status).toBe(404);
  });
});
