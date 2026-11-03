// 💶 Webes Coin-feltöltés Stripe Checkouttal (PRO-CASH C1.5, 8.1–8.2).
//
// A weben (és az EU-ban DMA alapján az appból linkelve) a Coin 5 €-ba kerül, áruházi
// jutalék nélkül. A folyamat:
//   1. `/billing/stripe/checkout` (hitelesített) → Checkout Session a választott csomagra,
//      bruttó árral (`tax_behavior: inclusive`) és Stripe Taxszal (OSS: a vevő országának
//      ÁFÁ-ja). A user és a csomag a session ÉS a payment intent metaadatában utazik.
//   2. `/billing/stripe/webhook` — a Stripe aláírásával (`Stripe-Signature`, HMAC-SHA256)
//      ellenőrzött esemény; `checkout.session.completed` (fizetve) → jóváírás (vásárolt +
//      bónusz), `charge.refunded` / `charge.dispute.created` → visszavonás (coin_clawback).
//      Idempotens: a billing_webhook_events ugyanazt az esemény-id-t nem dolgozza fel kétszer.
// A web-előfizetés is Coinból megy (subscribe_with_coins) — a legolcsóbb út, egy pénznem.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, WEB_BASE_URL (a sikeres/megszakított
// visszatérés címe). Kulcs nélkül a route 503 — semmi nem omlik össze.
const crypto = require('crypto');
const { coinPackFor } = require('./rcEvents');

// 1 Coin webes bruttó ára euró-centben (PRO-CASH 2.1: 5 €)
const WEB_EUR_CENTS_PER_COIN = 500;
// elektronikusan nyújtott szolgáltatás (Stripe Tax kód)
const TAX_CODE = 'txcd_10000000';
const SIGNATURE_TOLERANCE_SEC = 300;

function stripeConfigured(env = process.env) {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/**
 * A `Stripe-Signature` fejléc ellenőrzése (t=<unix>,v1=<hex>[,v1=…]) a Stripe leírása szerint:
 * HMAC-SHA256(secret, `${t}.${nyers törzs}`), időbélyeg a tűréshatáron belül, időzítés-
 * biztos összehasonlítás. Igaz, ha bármelyik v1 aláírás egyezik.
 */
function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = SIGNATURE_TOLERANCE_SEC) {
  if (!rawBody || !header || !secret) {
    return false;
  }
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > tolerance) {
    return false;
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  const exp = Buffer.from(expected, 'hex');
  return sigs.some((s) => {
    const got = Buffer.from(String(s), 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

/** Aláírás előállítása (tesztekhez és a lokális e2e-hez — ugyanaz a képlet, mint a Stripe-é). */
function signStripePayload(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** A Checkout Session form-paraméterei (application/x-www-form-urlencoded, a Stripe API alakja). */
function checkoutParams({ userId, packId, successUrl, cancelUrl }) {
  const pack = coinPackFor(packId);
  if (!pack || !userId) {
    return null;
  }
  const coins = pack.cents / 100;
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', successUrl);
  p.set('cancel_url', cancelUrl);
  p.set('client_reference_id', userId);
  p.set('automatic_tax[enabled]', 'true');
  // 8.5: digitális tartalom azonnali teljesítése — az elállási jogról szóló tájékoztatás
  p.set(
    'custom_text[submit][message]',
    'A Coin a fizetés után azonnal a fiókodba kerül. A teljesítés megkezdésével a 14 napos elállási jogod megszűnik. A vásárolt Coin pénzre nem váltható.'
  );
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'eur');
  p.set('line_items[0][price_data][unit_amount]', String(coins * WEB_EUR_CENTS_PER_COIN));
  p.set('line_items[0][price_data][tax_behavior]', 'inclusive');
  p.set('line_items[0][price_data][product_data][name]', `ReMix Coin × ${coins}`);
  p.set('line_items[0][price_data][product_data][tax_code]', TAX_CODE);
  for (const [k, v] of [['user_id', userId], ['pack_id', pack.id]]) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  return p;
}

/** Checkout Session létrehozása a Stripe API-n. Visszaadja: { id, url }. `fetchImpl` injektálható. */
async function createCheckoutSession(args, env = process.env, fetchImpl = fetch) {
  const params = checkoutParams(args);
  if (!params) {
    throw new Error('invalid_pack');
  }
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error((data && data.error && data.error.message) || `Stripe hiba (${res.status})`);
  }
  return { id: data.id, url: data.url };
}

/**
 * Stripe-esemény → teendő (tiszta). Alakok:
 *   { action: 'coins', userId, cents, bonusCents, ref }
 *   { action: 'coins_refund', userId, cents, ref }     (visszatérítés / vitatott terhelés)
 *   { action: 'kyc', userId, accountRef, status }        (Connect: account.updated)
 *   { action: 'ignore', reason }
 */
function planStripeEvent(event) {
  const type = event && event.type;
  const obj = (event && event.data && event.data.object) || {};
  const meta = obj.metadata || {};
  const pack = coinPackFor(meta.pack_id);
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid') {
      return { action: 'ignore', reason: `unpaid:${obj.payment_status || '-'}` };
    }
    if (!pack || !meta.user_id) {
      return { action: 'ignore', reason: 'unknown_pack' };
    }
    return { action: 'coins', userId: meta.user_id, cents: pack.cents, bonusCents: pack.bonusCents, ref: obj.payment_intent || obj.id };
  }
  if (type === 'charge.refunded' || type === 'charge.dispute.created') {
    if (!pack || !meta.user_id) {
      return { action: 'ignore', reason: 'unknown_pack' };
    }
    // részleges visszatérítésnél arányosan (a teljes csomag ára a csomag Coinja + bónusza)
    const total = pack.cents + pack.bonusCents;
    const amount = Number(obj.amount) || 0;
    const refunded = type === 'charge.refunded' ? Number(obj.amount_refunded) || amount : amount;
    const cents = amount > 0 ? Math.min(total, Math.ceil((total * refunded) / amount)) : total;
    return { action: 'coins_refund', userId: meta.user_id, cents, ref: obj.payment_intent || obj.id };
  }
  // 🪪 Stripe Connect (C3.3): a kapcsolt fiók KYC-állapota
  if (type === 'account.updated') {
    const { kycStatusFromAccount } = require('./stripeConnect');
    if (!meta.user_id || !obj.id) {
      return { action: 'ignore', reason: 'account_without_user' };
    }
    return { action: 'kyc', userId: meta.user_id, accountRef: obj.id, status: kycStatusFromAccount(obj) };
  }
  return { action: 'ignore', reason: type || 'unknown' };
}

module.exports = {
  WEB_EUR_CENTS_PER_COIN,
  stripeConfigured,
  verifyStripeSignature,
  signStripePayload,
  checkoutParams,
  createCheckoutSession,
  planStripeEvent,
};
