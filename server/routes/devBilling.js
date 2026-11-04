const { logCaught } = require('../lib/caught');
// 🧪 DEV-admin a PRO-CASH teszteléséhez — CSAK `ALLOW_DEV_BILLING=1` mellett (devBillingGuard),
// és mindig a HÍVÓ saját fiókjára (a verifikált tokenből). Élesben a kapu zárva → 403.
//
//   POST /dev/billing/tier   { tier, days?, seats? }   szint beállítása (Vállalati: dev-szervezettel)
//   POST /dev/coins          { coins, bucket }          Coin jóváírás: purchased | bonus | earned | earned_available
//   POST /dev/kyc            { status }                 kifizetési azonosítás állapota
//   POST /dev/cycle          { action }                 expire_now: a periódus most lejár + megújítás · release: tartás-feloldás
//   POST /dev/wallet/reset   {}                         az egyenleg nullázása (a naplóban visszavonásként)

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { devBillingGuard } = require('../lib/guards');
const { adminClient } = require('../notify');
const { activateTier, deactivatePro, grantCoins } = require('../billing');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const TIERS = ['free', 'basic', 'pro', 'ultra', 'business'];
const BUCKETS = ['purchased', 'bonus', 'earned', 'earned_available'];

function ctx(req, res) {
  const uid = callerId(req, (req.body ?? {}).userId);
  const sb = adminClient();
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return null;
  }
  if (!sb) {
    res.status(503).json({ error: 'service_role hiányzik' });
    return null;
  }
  return { uid, sb };
}

async function rpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** A hívó dev-szervezete (ha nincs tagsága, létrehozzuk és ellenőrzöttre állítjuk). */
async function ensureDevOrg(sb, uid) {
  const { data: m } = await sb.from('org_members').select('org_id, role').eq('user_id', uid).maybeSingle();
  if (m) {
    if (m.role !== 'owner') {
      throw new Error('A Vállalati teszthez a szervezet tulajdonosának kell lenned (most tag vagy).');
    }
    await sb.from('organizations').update({ status: 'verified', verified_at: new Date().toISOString() }).eq('id', m.org_id);
    return m.org_id;
  }
  const { data: org, error } = await sb
    .from('organizations')
    .insert({ name: 'Dev szervezet', country: 'HU', vat_id: 'HU00000000', domain: 'dev.remix.local', owner_id: uid, status: 'verified', verified_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const { error: mErr } = await sb.from('org_members').insert({ org_id: org.id, user_id: uid, role: 'owner' });
  if (mErr) {
    throw new Error(mErr.message);
  }
  return org.id;
}

const wrap = (fn) => (req, res) => {
  const c = ctx(req, res);
  if (!c) {
    return;
  }
  fn(c, req.body ?? {})
    .then((out) => res.json(out))
    .catch((err) => {
      logCaught('routes/devBilling.js', err);
      res.status(400).json({ error: err.message });
    });
};

router.post('/dev/billing/tier', express.json({ limit: '4kb' }), devBillingGuard, requireAuth, wrap(async ({ uid, sb }, body) => {
  const tier = String(body.tier || '');
  if (!TIERS.includes(tier)) {
    throw new Error('Ismeretlen szint.');
  }
  if (tier === 'free') {
    await deactivatePro(uid, { source: 'manual', status: 'canceled' });
    await sb.from('subscriptions').update({ org_id: null, auto_renew: false, pending_tier: null }).eq('user_id', uid);
    return { tier: 'free' };
  }
  const days = Math.min(400, Math.max(1, Math.trunc(Number(body.days) || 30)));
  const end = new Date(Date.now() + days * DAY_MS).toISOString();
  if (tier === 'business') {
    const orgId = await ensureDevOrg(sb, uid);
    const seats = Math.max(2, Math.trunc(Number(body.seats) || 3));
    const { error } = await sb.from('subscriptions').upsert(
      { user_id: uid, tier: 'business', seats, org_id: orgId, status: 'active', source: 'manual', billing_period: 'month', period_start: new Date().toISOString(), current_period_end: end, auto_renew: false },
      { onConflict: 'user_id' }
    );
    if (error) {
      throw new Error(error.message);
    }
    return { tier, seats, orgId, until: end };
  }
  // a Coinos ciklus próbájához (megújítás, add-on) a forrás `coins`, periódus-kezdettel
  const out = await activateTier(uid, tier, { source: body.coinBilled ? 'coins' : 'manual', until: end });
  await sb.from('subscriptions').update({ org_id: null, period_start: new Date().toISOString(), billing_period: 'month', auto_renew: !!body.coinBilled }).eq('user_id', uid);
  return out;
}));

router.post('/dev/coins', express.json({ limit: '4kb' }), devBillingGuard, requireAuth, wrap(async ({ uid, sb }, body) => {
  const coins = Number(body.coins);
  const bucket = BUCKETS.includes(body.bucket) ? body.bucket : 'purchased';
  if (!Number.isFinite(coins) || coins <= 0 || coins > 100000) {
    throw new Error('Érvénytelen Coin-mennyiség (0 < x ≤ 100 000).');
  }
  const cents = Math.round(coins * 100);
  if (bucket === 'earned_available') {
    // megkeresett, és a 30 napos tartás már letelt → azonnal kifizethető (a kifizetés teszteléséhez)
    await rpc(sb, 'coin_credit', { p_user: uid, p_cents: cents, p_bucket: 'earned', p_kind: 'sale', p_note: 'dev', p_ref: null, p_payer: null });
    await sb.from('coin_lots').update({ available_at: new Date(Date.now() - 60000).toISOString() }).eq('user_id', uid).eq('status', 'pending').eq('bucket', 'earned');
    await rpc(sb, 'coin_release_due', { p_now: new Date().toISOString() });
  } else if (bucket === 'earned') {
    await rpc(sb, 'coin_credit', { p_user: uid, p_cents: cents, p_bucket: 'earned', p_kind: 'sale', p_note: 'dev', p_ref: null, p_payer: null });
  } else {
    await grantCoins(uid, cents, bucket, bucket === 'bonus' ? 'bonus' : 'topup', 'dev');
  }
  const { data } = await sb.from('user_credits').select('purchased_cents, bonus_cents, earned_pending_cents, earned_available_cents, balance').eq('user_id', uid).maybeSingle();
  return { wallet: data };
}));

router.post('/dev/kyc', express.json({ limit: '4kb' }), devBillingGuard, requireAuth, wrap(async ({ uid, sb }, body) => {
  const status = ['none', 'pending', 'verified', 'rejected'].includes(body.status) ? body.status : 'verified';
  await rpc(sb, 'set_kyc_status', { p_user: uid, p_provider: 'paypal', p_status: status, p_account_ref: null });
  const { data: acct } = await sb.from('payout_accounts').select('email').eq('user_id', uid).maybeSingle();
  if (!acct || !acct.email) {
    await sb.from('payout_accounts').update({ email: 'dev-payout@remix.local' }).eq('user_id', uid);
  }
  return { kyc: status };
}));

router.post('/dev/cycle', express.json({ limit: '4kb' }), devBillingGuard, requireAuth, wrap(async ({ uid, sb }, body) => {
  const now = new Date();
  if (body.action === 'expire_now') {
    // a periódus most jár le → a megújítás (Coinból) vagy a visszaesés azonnal kipróbálható
    await sb.from('subscriptions').update({ current_period_end: new Date(now.getTime() - 60000).toISOString() }).eq('user_id', uid);
    const renew = await rpc(sb, 'renew_due_subscriptions', { p_now: now.toISOString() });
    return { renew };
  }
  await sb.from('coin_lots').update({ available_at: new Date(now.getTime() - 60000).toISOString() }).eq('user_id', uid).eq('status', 'pending').eq('bucket', 'earned');
  return { released: await rpc(sb, 'coin_release_due', { p_now: now.toISOString() }) };
}));

router.post('/dev/wallet/reset', express.json({ limit: '4kb' }), devBillingGuard, requireAuth, wrap(async ({ uid, sb }) => {
  const { data: w } = await sb.from('user_credits').select('balance').eq('user_id', uid).maybeSingle();
  if (w && Number(w.balance) > 0) {
    await rpc(sb, 'coin_clawback', { p_user: uid, p_cents: Number(w.balance), p_note: 'dev_reset' });
  }
  await sb.from('user_credits').update({ review_required: false, review_reason: null }).eq('user_id', uid);
  return { balance: 0 };
}));

module.exports = router;
