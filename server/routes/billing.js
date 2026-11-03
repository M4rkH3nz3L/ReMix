const { logCaught } = require('../lib/caught');
// 💳 Billing / shop-kredit route-ok (manuális/dev aktiválás + RevenueCat webhook).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből
// — a viselkedés változatlan (a kétrétegű devBillingGuard + requireAuth védelem, és
// a 503/401 hiba-precedencia megőrizve). A séma-validáció itt NEM kerül be, mert a
// handlerek a 503 (billing-config) / 401 (auth) ellenőrzést a mező-ellenőrzés ELŐTT
// végzik — a validáció-middleware megváltoztatná a hiba-precedenciát.

const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { devBillingGuard } = require('../lib/guards');
const {
  billingAvailable,
  activatePro,
  deactivatePro,
  grantCoins,
  handleRevenueCatEvent,
  handleStripeEvent,
} = require('../billing');
const { stripeConfigured, verifyStripeSignature, createCheckoutSession } = require('../stripe');
const { coinPackFor } = require('../rcEvents');

const router = express.Router();

// 💳 Pro aktiválás — MANUÁLIS / DEV / promó út (a valós pénz a RevenueCat webhookon).
router.post('/billing/activate', express.json({ limit: '16kb' }), devBillingGuard, requireAuth, (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  const { days } = req.body ?? {};
  const userId = callerId(req, (req.body ?? {}).userId);
  if (!userId) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  activatePro(userId, { days: Number.isFinite(days) ? days : 30, source: 'manual' })
    .then((result) => res.json(result))
    .catch((err) => {
    logCaught('routes/billing.js', err);
      console.error('Billing activate hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 🪙 Coin-feltöltés — DEV/manuális: `amount` Coin a VÁSÁROLT alegyenlegre (a valós
// feltöltés a RevenueCat consumable / Stripe webhookon).
router.post('/shop/credits/grant', express.json({ limit: '16kb' }), devBillingGuard, requireAuth, (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva' });
    return;
  }
  const { amount } = req.body ?? {};
  const userId = callerId(req, (req.body ?? {}).userId);
  if (!userId) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const coins = Number.isFinite(amount) && amount > 0 ? Math.min(amount, 1000) : 10;
  grantCoins(userId, Math.round(coins * 100), 'purchased', 'topup', 'manual')
    .then((result) => res.json(result))
    .catch((err) => {
    logCaught('routes/billing.js', err);
      console.error('Credit grant hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 💳 Pro visszavonás — DEV/manuális (teszteléshez).
router.post('/billing/deactivate', express.json({ limit: '16kb' }), devBillingGuard, requireAuth, (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva' });
    return;
  }
  const target = callerId(req, (req.body ?? {}).userId);
  if (!target) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  deactivatePro(target, { source: 'manual', status: 'canceled' })
    .then((result) => res.json(result))
    .catch((err) => {
    logCaught('routes/billing.js', err);
      console.error('Billing deactivate hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 💳 RevenueCat webhook — a VALÓS pénz-út (App Store / Play IAP). RC_WEBHOOK_AUTH-hoz kötött.
router.post('/billing/revenuecat', express.json({ limit: '256kb' }), (req, res) => {
  const secret = process.env.RC_WEBHOOK_AUTH;
  if (!secret || !billingAvailable()) {
    res.status(503).json({ error: 'RevenueCat webhook nincs konfigurálva (RC_WEBHOOK_AUTH / service_role)' });
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== secret && auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  handleRevenueCatEvent(req.body ?? {})
    .then((result) => res.json(result))
    .catch((err) => {
    logCaught('routes/billing.js', err);
      console.error('RevenueCat webhook hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

module.exports = router;

// 💶 Webes Coin-feltöltés (PRO-CASH C1.5): Checkout Session a választott csomagra. A hívó a
// VERIFIKÁLT tokenből; a sikeres fizetést a webhook írja jóvá (nem ez a válasz).
router.post('/billing/stripe/checkout', express.json({ limit: '4kb' }), requireAuth, (req, res) => {
  if (!stripeConfigured() || !billingAvailable()) {
    res.status(503).json({ error: 'A webes fizetés nincs konfigurálva (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).' });
    return;
  }
  const userId = callerId(req, (req.body ?? {}).userId);
  const packId = String((req.body ?? {}).packId || '');
  if (!userId) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  if (!coinPackFor(packId)) {
    res.status(400).json({ error: 'invalid_pack' });
    return;
  }
  const base = (process.env.WEB_BASE_URL || '').replace(/\/$/, '');
  createCheckoutSession({
    userId,
    packId,
    successUrl: `${base}/coins?status=ok`,
    cancelUrl: `${base}/coins?status=cancel`,
  })
    .then((session) => res.json(session))
    .catch((err) => {
      logCaught('routes/billing.js', err);
      res.status(502).json({ error: err.message });
    });
});

// 💶 Stripe webhook — a NYERS törzs kell az aláíráshoz (Stripe-Signature, HMAC-SHA256).
router.post('/billing/stripe/webhook', express.raw({ type: '*/*', limit: '512kb' }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !billingAvailable()) {
    res.status(503).json({ error: 'Stripe webhook nincs konfigurálva' });
    return;
  }
  if (!verifyStripeSignature(req.body, req.headers['stripe-signature'], secret)) {
    res.status(400).json({ error: 'invalid_signature' });
    return;
  }
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
  } catch (caught) {
    logCaught('routes/billing.js:stripeWebhook', caught);
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  handleStripeEvent(event)
    .then((result) => res.json(result))
    .catch((err) => {
      logCaught('routes/billing.js', err);
      res.status(400).json({ error: err.message });
    });
});
