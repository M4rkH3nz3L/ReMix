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
} = require('../billing');

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
