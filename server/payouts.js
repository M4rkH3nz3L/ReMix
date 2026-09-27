// 💸 Kifizetés (koin → pénz) — provideres, automata utalás.
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || `PayPal token hiba (${res.status})`);
  }
  return data.access_token;
}

/**
 * Kifizetés a célszámlára. Visszaadja a provider-referenciát (batch id).
 * `account`: { provider, email }. `amountHuf`: egész forint (HUF 0-decimális).
 */
async function sendPayout(account, amountHuf, note) {
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
        email_message: note || 'Koin-kiváltás a ReMixből.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: String(Math.trunc(amountHuf)), currency: 'HUF' },
          receiver: account.email,
          note: note || 'ReMix payout',
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `PayPal payout hiba (${res.status})`);
  }
  return data.batch_header?.payout_batch_id || null;
}

module.exports = { payoutsConfigured, sendPayout };
