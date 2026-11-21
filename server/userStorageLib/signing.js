const { logCaught } = require('../lib/caught');
// 🔌 Külső tárhely — HMAC-aláírás: az OAuth-state és a /file capability-token.
const crypto = require('crypto');

// 🔒 A HMAC-titok CSAK az OAUTH_STATE_SECRET. Production-ben hiánya esetén NINCS titok (''):
// az aláírás 503-as hibát dob, az ellenőrzés mindig elutasít — a beégetett konstanssal bárki
// hamisíthatna lejárat nélküli fájl-tokent bármely uid-ra. A service-role kulcs NEM HMAC-titok
// (a legérzékenyebb kulcs kettős használata). Dev/teszt: a dev-konstans (lokális munkához).
const STATE_SECRET = (() => {
  const own = (process.env.OAUTH_STATE_SECRET || '').trim();
  if (own) {
    return own;
  }
  return process.env.NODE_ENV === 'production' ? '' : 'insecure-dev-secret';
})();

/** Aláíráshoz: a titok, vagy prod-ban hiányzó titoknál definiált 503-as hiba. */
function requireSecret() {
  if (!STATE_SECRET) {
    const err = new Error('A külső tárhely-aláírás nincs konfigurálva a workeren (OAUTH_STATE_SECRET hiányzik).');
    err.status = 503;
    throw err;
  }
  return STATE_SECRET;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signState(obj) {
  const payload = b64url(JSON.stringify(obj));
  const sig = crypto.createHmac('sha256', requireSecret()).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function verifyState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!STATE_SECRET || !payload || !sig) {
    return null;
  }
  const expect = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 32);
  if (sig !== expect) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (caught) {
    logCaught('userStorage.js:verifyState', caught);
    return null;
  }
}

// ── capability-token a /file-hoz: a per-user privát fájl stream-URL-je BEÁGYAZÓDIK
// a projektbe (weben a lejátszó KÉSŐBB is hívja, bearer-fejléc nélkül), ezért
// aláírt, a (user, forrás, út) hármasra kötött, LEJÁRAT NÉLKÜLI capability kell —
// mint egy aláírt S3-URL. Visszavonás: a `user_storage_providers` sor törlésével
// a `findUserSource` már nem találja → a stream elhal.
function fileToken(uid, sourceId, path) {
  const sig = crypto
    .createHmac('sha256', requireSecret())
    .update(`${uid}:${sourceId}:${path}`)
    .digest('hex')
    .slice(0, 32);
  return `${b64url(uid)}.${sig}`;
}
function verifyFileToken(token, sourceId, path) {
  const [uidB64, sig] = String(token || '').split('.');
  if (!STATE_SECRET || !uidB64 || !sig) {
    return null;
  }
  let uid;
  try {
    uid = Buffer.from(uidB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (caught) {
    logCaught('userStorage.js:verifyFileToken', caught);
    return null;
  }
  const expect = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(`${uid}:${sourceId}:${path}`)
    .digest('hex')
    .slice(0, 32);
  return sig === expect ? uid : null;
}

module.exports = { STATE_SECRET, b64url, signState, verifyState, fileToken, verifyFileToken };
