// 🔐 RTMP stream-kulcs titkosítás nyugalmi állapotban (LIVE.md Fázis F).
//
// A multistream-célok stream-kulcsa (YouTube/Twitch/… RTMP ingest-titok) NEM
// tárolható nyersen: aki a DB-hez fér (dump, backup, support), az nem streamelhet
// a felhasználó nevében. A kulcsot a WORKER titkosítja (AES-256-GCM) egy
// szerver-only kulccsal (`LIVE_STREAM_KEY_SECRET`), és csak az egress-indításkor
// fejti vissza. A kliens sosem tárol/olvas nyers kulcsot — csak TLS-en POST-olja
// a workernek (`/live/destinations/set-key`).
//
// Formátum:  enc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
// Visszafelé-kompatibilis: egy `enc:v1:` előtag NÉLKÜLI érték NYERS kulcsként
// megy vissza (régi/dev adat), hogy a már létező célok ne törjenek el.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

/** A 32 bájtos AES-kulcs a secretből (sha256). `null`, ha nincs secret konfigurálva. */
function deriveKey() {
  const secret = (process.env.LIVE_STREAM_KEY_SECRET || '').trim();
  if (!secret) {
    return null;
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest(); // 32 byte
}

/** Be van-e kapcsolva a titkosítás (van `LIVE_STREAM_KEY_SECRET`). */
function encryptionEnabled() {
  return !!deriveKey();
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Nyers kulcs → tárolható érték. Ha nincs secret, a nyers kulcsot adja vissza
 * (dev; a hívó loggolhat figyelmeztetést). Üres bemenetre üres stringet ad.
 */
function encryptStreamKey(plain) {
  const text = String(plain ?? '');
  if (!text) {
    return '';
  }
  const key = deriveKey();
  if (!key) {
    return text; // nincs secret → nyers (dev); prod-ban LIVE_STREAM_KEY_SECRET kell
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${b64url(iv)}:${b64url(tag)}:${b64url(ct)}`;
}

/**
 * Tárolt érték → nyers kulcs. A `enc:v1:` nélküli értéket változatlanul adja
 * vissza (régi/dev nyers kulcs). Hibás/hamisított titkosított értékre dob.
 */
function decryptStreamKey(stored) {
  const text = String(stored ?? '');
  if (!text || !text.startsWith(PREFIX)) {
    return text; // nyers (backward-compat)
  }
  const key = deriveKey();
  if (!key) {
    throw new Error('Titkosított stream-kulcs, de nincs LIVE_STREAM_KEY_SECRET a dekódoláshoz.');
  }
  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Érvénytelen titkosított kulcs-formátum.');
  }
  const iv = fromB64url(parts[0]);
  const tag = fromB64url(parts[1]);
  const ct = fromB64url(parts[2]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Titkosítva van-e már a tárolt érték (a `hasKey` + migráció-jelzéshez). */
function isEncrypted(stored) {
  return String(stored ?? '').startsWith(PREFIX);
}

module.exports = {
  encryptStreamKey,
  decryptStreamKey,
  encryptionEnabled,
  isEncrypted,
};
