// 🔌 Integrációs teszt az AI domain-routerre (01-api-architecture §01.1).
// A router minimális Express-appon; determinisztikus mező-validációs 400-ak (külső
// AI-hívás nélkül) + a routeInventory() betöltéskori feltöltésének ellenőrzése.

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const ai = require('../ai');
const { routeInventory } = require('../../security/authorization');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(ai);
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

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('AI domain-router (e2e)', () => {
  test('a router betöltése feltölti a routeInventory-t (/ai/hooks, policy+rate-class)', () => {
    const inv = routeInventory();
    const hooks = inv.find((r) => r.path === '/ai/hooks' && r.method === 'POST');
    expect(hooks).toBeDefined();
    expect(hooks.level).toBe('AUTHENTICATED');
    expect(hooks.rateClass).toBe('ai');
  });

  test('POST /ai/hooks üres → 400 { code:"validation", issues } (zod-validáció §01.2)', async () => {
    const { status, json } = await post('/ai/hooks', {});
    expect(status).toBe(400);
    expect(typeof json.error).toBe('string');
    expect(json.code).toBe('validation');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues[0].path).toBe('summary');
  });

  test('POST /ai/assist üres → 400 + issues (instruction hiány)', async () => {
    const { status, json } = await post('/ai/assist', {});
    expect(status).toBe(400);
    expect(json.code).toBe('validation');
    expect(json.issues.some((i) => i.path === 'instruction')).toBe(true);
  });

  test('POST /ai/captionstudio üres segments → 400 + issues', async () => {
    const { status, json } = await post('/ai/captionstudio', { segments: [] });
    expect(status).toBe(400);
    expect(json.code).toBe('validation');
    expect(json.issues.some((i) => i.path === 'segments')).toBe(true);
  });

  test('POST /ai/highlights nem-objektum context → 400 + issues', async () => {
    const { status, json } = await post('/ai/highlights', { context: null });
    expect(status).toBe(400);
    expect(json.code).toBe('validation');
  });

  test('POST /ai/translate hiányzó lang → 400', async () => {
    const { status } = await post('/ai/translate', { segments: [{ id: 1 }] });
    expect(status).toBe(400);
  });

  test('POST /ai/probe aiConfig nélkül → 200 { ok:false } (nem hív AI-t)', async () => {
    const { status, json } = await post('/ai/probe', {});
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
  });
});
