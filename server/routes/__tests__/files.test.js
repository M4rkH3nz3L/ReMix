// 🔌 Integrációs teszt a ReMix Storage (/files/*) domain-routerre, lokális disk-backenddel.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
process.env.STORAGE_BACKEND = '';
process.env.USER_FILES_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'files-route-'));
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));
jest.mock('../../quota', () => {
  const actual = jest.requireActual('../../quota');
  return { ...actual, quotaAvailable: () => false, recordObject: async () => null, forgetObject: async () => {}, moveObject: async () => {} };
});

const express = require('express');
const files = require('../files');

const app = express();
app.use(files);

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

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('files domain-router (e2e)', () => {
  test('userId nélkül → 401', async () => {
    expect((await fetch(base + '/files/list')).status).toBe(401);
  });

  test('mappa → feltöltés → listázás → letöltés → törlés', async () => {
    const q = 'userId=user1';
    let res = await fetch(`${base}/files/folder`, json({ userId: 'user1', path: '', name: 'Projekt anyag' }));
    expect(res.status).toBe(200);

    const form = new FormData();
    form.append('media', new Blob(['hello world']), 'klip.mp4');
    form.append('path', 'Projekt anyag');
    form.append('userId', 'user1');
    res = await fetch(`${base}/files/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ path: 'Projekt anyag/klip.mp4', size: 11 });

    res = await fetch(`${base}/files/list?${q}&path=${encodeURIComponent('Projekt anyag')}`);
    const listed = await res.json();
    expect(listed.files.map((f) => f.name)).toEqual(['klip.mp4']);

    res = await fetch(`${base}/files/download?${q}&path=${encodeURIComponent('Projekt anyag/klip.mp4')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');

    res = await fetch(`${base}/files/delete`, json({ userId: 'user1', paths: ['Projekt anyag'] }));
    expect(await res.json()).toEqual({ removed: 1, bytes: 11 });
  });

  test('kiszökő út → 400, nem létező → 404', async () => {
    expect((await fetch(`${base}/files/list?userId=u&path=..%2Fx`)).status).toBe(400);
    expect((await fetch(`${base}/files/download?userId=u&path=nincs.mp4`)).status).toBe(404);
  });
});
