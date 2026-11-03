const { logCaught } = require('./lib/caught');
// 💸 Kifizetés (megkeresett Coin → euró) — provideres, automata utalás.
//
// A koin-levonás + a payout-sor a DB-ben SZERVER-HITELES (request_payout_for RPC,
// service_role). A tényleges pénzutalást EZ intézi: jelenleg PayPal Payouts (env-
// kapuzva, mint a RevenueCat). Kulcsok nélkül a payoutsConfigured() false → a
// kérelem 'pending' marad (manuális teljesítés), nem omlik össze semmi.
//
// Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV=live|sandbox (alap: sandbox).
const crypto = require('crypto');

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

/** Be van-e kötve a kifizetés-provider (megy-e az automata utalás). */
function payoutsConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

async function paypalToken() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString(
    'base64'
  );
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch((caught) => { logCaught('payouts.js:paypalToken', caught); return {}; });
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || `PayPal token hiba (${res.status})`);
  }
  return data.access_token;
}

/** euró-cent → a PayPal által várt két tizedes szöveg ("60.00"). */
function eurValue(amountEurCents) {
  return (Math.trunc(amountEurCents) / 100).toFixed(2);
}

/**
 * Kifizetés a célszámlára. Visszaadja a provider-referenciát (batch id).
 * `account`: { provider, email }. `amountEurCents`: egész euró-cent (PRO-CASH: EUR-ban fizetünk).
 */
async function sendPayout(account, amountEurCents, note) {
  if (!account || account.provider !== 'paypal') {
    throw new Error('Jelenleg csak PayPal-kifizetés támogatott.');
  }
  if (!account.email) {
    throw new Error('Hiányzó PayPal e-mail a célszámlán.');
  }
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/payments/payouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: `remix-${crypto.randomUUID()}`,
        email_subject: 'ReMix kifizetés',
        email_message: note || 'Coin-beváltás a ReMixből.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: eurValue(amountEurCents), currency: 'EUR' },
          receiver: account.email,
          note: note || 'ReMix payout',
        },
      ],
    }),
  });
  const data = await res.json().catch((caught) => { logCaught('payouts.js:sendPayout', caught); return {}; });
  if (!res.ok) {
    throw new Error(data.message || `PayPal payout hiba (${res.status})`);
  }
  return data.batch_header?.payout_batch_id || null;
}

module.exports = { payoutsConfigured, sendPayout, eurValue };
