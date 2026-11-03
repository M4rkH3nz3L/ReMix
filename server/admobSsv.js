const { logCaught } = require('./lib/caught');
// 🎬 AdMob jutalmazott reklám — szerveroldali ellenőrzés (SSV, PRO-CASH C2.2).
//
// Az AdMob a reklám végignézése után GET-tel hívja a `/ads/ssv` végpontot; a jutalmat CSAK
// akkor írjuk jóvá, ha az aláírás érvényes. A Google leírása szerint:
//   • az aláírt üzenet a query string a `signature` paraméter ELŐTTI része (a `&` nélkül);
//   • az aláírás websafe-base64 DER ECDSA (P-256, SHA-256), a `key_id` mondja meg a kulcsot;
//   • a nyilvános kulcsok: https://www.gstatic.com/admob/reward/verifier-keys.json (cache-elve).
// A `user_id` a mi felhasználónk (a kliens a rewarded-reklám betöltésekor adja meg, SSV opció).
const crypto = require('crypto');

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
let keyCache = { at: 0, keys: null };

/** A query string aláírt része és a mezők. Null, ha nincs aláírás / kulcs-azonosító. */
function parseSsvQuery(rawQuery) {
  const q = String(rawQuery || '').replace(/^\?/, '');
  const i = q.indexOf('&signature=');
  if (i < 0) {
    return null;
  }
  const message = q.slice(0, i);
  const params = new URLSearchParams(q);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) {
    return null;
  }
  return {
    message,
    signature,
    keyId: String(keyId),
    userId: params.get('user_id') || '',
    transactionId: params.get('transaction_id') || '',
    adUnit: params.get('ad_unit') || '',
    rewardAmount: Number(params.get('reward_amount') || 0),
  };
}

/** websafe base64 → Buffer */
function fromWebSafeBase64(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64');
}

/** Az aláírás ellenőrzése. `keys`: { [keyId]: pem }. */
function verifySsv(parsed, keys) {
  if (!parsed || !keys) {
    return false;
  }
  const pem = keys[parsed.keyId];
  if (!pem) {
    return false;
  }
  try {
    return crypto.verify('sha256', Buffer.from(parsed.message, 'utf8'), pem, fromWebSafeBase64(parsed.signature));
  } catch (caught) {
    logCaught('admobSsv.js:verifySsv', caught);
    return false;
  }
}

/** A Google ellenőrző kulcsai (24 órás cache). `fetchImpl` injektálható. */
async function verifierKeys(fetchImpl = fetch, now = Date.now()) {
  if (keyCache.keys && now - keyCache.at < KEYS_TTL_MS) {
    return keyCache.keys;
  }
  const res = await fetchImpl(KEYS_URL);
  if (!res.ok) {
    throw new Error(`AdMob kulcsok nem érhetők el (${res.status})`);
  }
  const data = await res.json();
  const keys = {};
  for (const k of (data && data.keys) || []) {
    if (k && k.keyId != null && k.pem) {
      keys[String(k.keyId)] = k.pem;
    }
  }
  keyCache = { at: now, keys };
  return keys;
}

function resetKeyCache() {
  keyCache = { at: 0, keys: null };
}

module.exports = { parseSsvQuery, verifySsv, verifierKeys, resetKeyCache, fromWebSafeBase64 };
