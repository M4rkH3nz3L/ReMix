// 🔌 Integrációs teszt a storage domain-routerre (01-api-architecture §01.1).
// A router minimális Express-appon; determinisztikus válaszok külső tárhely nélkül.

process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const express = require('express');
const storage = require('../storage');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(storage);
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

describe('storage domain-router (e2e)', () => {
  test('a router betölthető (express-middleware)', () => {
    expect(typeof storage).toBe('function');
  });

  test('GET /storage/connected userId nélkül → 401', async () => {
    const res = await fetch(base + '/storage/connected');
    expect(res.status).toBe(401);
  });

  test('POST /storage/connect érvénytelen típus (ftp) → 400', async () => {
    const res = await fetch(base + '/storage/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', type: 'ftp' }),
    });
    expect(res.status).toBe(400);
    const b = await res.json().catch(() => null);
    expect(b && typeof b.error).toBe('string');
  });

  test('GET /storage/sources userId nélkül → 200 { sources: [] } (user=[], nincs globális config)', async () => {
    const res = await fetch(base + '/storage/sources');
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(Array.isArray(b.sources)).toBe(true);
  });

  test('🔒 támadás: a tükrözött ?error= HTML-escape-elve (nem futtatható <script>)', async () => {
    const res = await fetch(base + '/storage/oauth/gdrive/callback?error=' + encodeURIComponent('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  test('🔒 támadás: </script>-et tartalmazó returnUrl nem tör ki a script-blokkból; a legitim deep link működik', async () => {
    const userStorage = require('../../userStorage');
    const spy = jest.spyOn(userStorage, 'oauthCallback');
    try {
      spy.mockResolvedValueOnce('remix://x</script><script>alert(1)</script><!--');
      let body = await (await fetch(base + '/storage/oauth/gdrive/callback?code=c&state=s')).text();
      expect(body.match(/<script>/g)).toHaveLength(1);
      expect(body).not.toContain('</script><script>');
      expect(body).not.toContain('<!--');
      spy.mockResolvedValueOnce('remix://storage/connected');
      body = await (await fetch(base + '/storage/oauth/gdrive/callback?code=c&state=s')).text();
      expect(body).toContain('<script>location.replace("remix://storage/connected")</script>');
    } finally {
      spy.mockRestore();
    }
  });

  test('🔒 a bekötési hiba szövege is escape-elve', async () => {
    const userStorage = require('../../userStorage');
    const spy = jest.spyOn(userStorage, 'oauthCallback').mockRejectedValueOnce(new Error('<img src=x onerror=alert(1)>'));
    try {
      const res = await fetch(base + '/storage/oauth/gdrive/callback?code=c&state=s');
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Bekötés sikertelen: &lt;img src=x onerror=alert(1)&gt;');
    } finally {
      spy.mockRestore();
    }
  });
});
