const { logCaught } = require('../lib/caught');
// 💰 Wallet route-ok (tarhely-kvota kijelzes + PayPal kifizetes).
// Domain-router (01-api-architecture §01.1). SZO SZERINT az index.js-bol.

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { usageFor, quotaAvailable } = require('../quota');
const { executeApproved } = require('../payoutRunner');
const { statementCsv, dac7Csv } = require('../earningsReports');
const { createExpressAccount, onboardingLink } = require('../stripeConnect');
const { adminClient } = require('../notify');

const router = express.Router();

// 🗄️ Tárhely-használat/kvóta (profil-kijelzés): a MI tárhelyünkön fekvő bájtok +
// az alap (tier) és a koinos bónusz. A hívó a VERIFIKÁLT tokenből.
router.get('/storage/usage', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  if (!quotaAvailable()) {
    res.status(503).json({ error: 'A tárhely-elszámolás nincs konfigurálva (service_role).' });
    return;
  }
  try {
    res.json({ usage: await usageFor(uid) });
  } catch (err) {
    logCaught('routes/wallet.js', err);
    res.status(500).json({ error: err.message });
  }
});

// 💸 Kifizetés: MEGKERESETT Coin → pénz (1 Coin = 3 €). A szabályokat a DB mondja ki
// (request_payout_for: KYC, min. 20 Coin, heti 1, csak a beváltható; gyanús kérés → kézi
// ellenőrzés). A tiszta kérés azonnal végrehajtódik az állapotgépen át (approved → processing
// → paid | failed); bekötött partner nélkül `approved` marad (kézi teljesítés). A hívó a
// VERIFIKÁLT tokenből — mást nem lehet a nevében kifizettetni.
router.post('/wallet/payout', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'A kifizetés nincs konfigurálva (service_role).' });
    return;
  }
  const cents = Math.trunc(Number(req.body?.cents || 0));
  if (!Number.isFinite(cents) || cents <= 0) {
    res.status(400).json({ error: 'Érvénytelen összeg (cent-Coin).' });
    return;
  }
  try {
    const { data: reqRow, error: rpcErr } = await sb.rpc('request_payout_for', { p_user: uid, p_cents: cents });
    if (rpcErr) {
      const known = /no_payout_account|kyc_required|insufficient_earned|below_min_payout|payout_weekly_limit|minor_no_payout/.exec(rpcErr.message);
      if (known) {
        res.status(400).json({ error: known[0] });
        return;
      }
      throw new Error(rpcErr.message);
    }
    if (reqRow.status !== 'approved') {
      res.json(reqRow); // under_review: kézi ellenőrzésre vár
      return;
    }
    const { data: acct } = await sb
      .from('payout_accounts')
      .select('provider, email, account_ref, kyc_status')
      .eq('user_id', uid)
      .maybeSingle();
    const status = await executeApproved(sb, { id: reqRow.request_id, amount_eur_cents: reqRow.amount_eur_cents }, acct);
    res.status(status === 'failed' ? 502 : 200).json({ ...reqRow, status });
  } catch (err) {
    logCaught('routes/wallet.js', err);
    res.status(500).json({ error: err.message });
  }
});

// 🪪 KYC a Stripe Connect Expressszel (C3.3): ha még nincs kapcsolt fiók, létrehozzuk, és
// visszaadjuk az egyszer használatos onboarding-címet. Az ellenőrzés eredményét a Stripe
// `account.updated` webhookja írja (set_kyc_status) — nem ez a válasz.
router.post('/wallet/kyc/stripe', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  const sb = adminClient();
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  if (!sb || !process.env.STRIPE_SECRET_KEY) {
    res.status(503).json({ error: 'A Stripe Connect nincs konfigurálva (STRIPE_SECRET_KEY).' });
    return;
  }
  try {
    const { data: acct } = await sb.from('payout_accounts').select('provider, account_ref, email').eq('user_id', uid).maybeSingle();
    let accountId = acct && acct.provider === 'stripe' ? acct.account_ref : null;
    if (!accountId) {
      accountId = await createExpressAccount({ userId: uid, email: acct?.email || undefined });
      const { error } = await sb.rpc('set_kyc_status', { p_user: uid, p_provider: 'stripe', p_status: 'pending', p_account_ref: accountId });
      if (error) {
        throw new Error(error.message);
      }
    }
    const base = (process.env.WEB_BASE_URL || '').replace(/\/$/, '');
    const url = await onboardingLink({ accountId, refreshUrl: `${base}/profile?kyc=retry`, returnUrl: `${base}/profile?kyc=done` });
    res.json({ url });
  } catch (err) {
    logCaught('routes/wallet.js:kyc', err);
    res.status(502).json({ error: err.message });
  }
});

// 📊 Az alkotó éves bevételi kimutatása CSV-ben (C3.5) — a saját adatai, a verifikált tokenből.
router.get('/wallet/statement', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  const sb = adminClient();
  const year = Math.trunc(Number(req.query.year)) || new Date().getUTCFullYear();
  if (!uid || !sb) {
    res.status(uid ? 503 : 401).json({ error: uid ? 'service_role hiányzik' : 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const { data, error } = await sb.rpc('earnings_statement_for', { p_user: uid, p_year: year });
    if (error) {
      throw new Error(error.message);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="remix-bevetel-${year}.csv"`);
    res.send(statementCsv(data));
  } catch (err) {
    logCaught('routes/wallet.js:statement', err);
    res.status(500).json({ error: err.message });
  }
});

// 🧾 DAC7-export (C3.5, 8.4) — csak `finance.manage` jogú adminnak.
router.get('/admin/dac7', requireAuth, async (req, res) => {
  const uid = req.user?.id;
  const sb = adminClient();
  const year = Math.trunc(Number(req.query.year)) || new Date().getUTCFullYear() - 1;
  if (!uid || !sb) {
    res.status(uid ? 503 : 401).json({ error: uid ? 'service_role hiányzik' : 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const { data: allowed } = await sb.rpc('has_permission', { p_uid: uid, p_key: 'finance.manage' });
    if (allowed !== true) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const { data, error } = await sb.rpc('dac7_report', { p_year: year });
    if (error) {
      throw new Error(error.message);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="remix-dac7-${year}.csv"`);
    res.send(dac7Csv(year, data));
  } catch (err) {
    logCaught('routes/wallet.js:dac7', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
