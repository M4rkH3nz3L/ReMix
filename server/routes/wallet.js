// 💰 Wallet route-ok (tarhely-kvota kijelzes + PayPal kifizetes).
// Domain-router (01-api-architecture §01.1). SZO SZERINT az index.js-bol.

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { usageFor, quotaAvailable } = require('../quota');
const { payoutsConfigured, sendPayout } = require('../payouts');
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
    res.status(500).json({ error: err.message });
  }
});

// 💸 Kifizetés: koin → pénz (3 Ft/koin). A koin-levonást + a 'pending' payout-sort
// az atomikus request_payout_for RPC végzi, majd megpróbáljuk a provider-utalást
// (PayPal). Provider nélkül a kérelem 'pending' marad (manuális teljesítés). A
// hívó a VERIFIKÁLT tokenből — mást nem lehet a nevében kifizettetni.
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
  const coins = Math.trunc(Number(req.body?.coins || 0));
  if (!Number.isFinite(coins) || coins <= 0) {
    res.status(400).json({ error: 'Érvénytelen koin-mennyiség.' });
    return;
  }
  try {
    const { data: acct } = await sb
      .from('payout_accounts')
      .select('provider, email')
      .eq('user_id', uid)
      .maybeSingle();
    if (!acct || !acct.email) {
      res.status(400).json({ error: 'no_payout_account' });
      return;
    }
    // levon + 'pending' payout-sor (atomikus, szerver-hiteles)
    const { data: reqRow, error: rpcErr } = await sb.rpc('request_payout_for', {
      p_user: uid,
      p_coins: coins,
    });
    if (rpcErr) {
      if (/insufficient_credits/.test(rpcErr.message)) {
        res.status(400).json({ error: 'insufficient_credits' });
        return;
      }
      if (/below_min_payout/.test(rpcErr.message)) {
        res.status(400).json({ error: 'below_min_payout' });
        return;
      }
      throw new Error(rpcErr.message);
    }
    if (!payoutsConfigured()) {
      // provider nincs beállítva → a kérelem 'pending' marad (manuális teljesítés)
      res.json({ status: 'pending', ...reqRow });
      return;
    }
    try {
      const ref = await sendPayout(acct, reqRow.amount_huf, `ReMix payout ${reqRow.request_id}`);
      await sb.rpc('resolve_payout', {
        p_request: reqRow.request_id,
        p_status: 'paid',
        p_provider_ref: ref,
      });
      res.json({ status: 'paid', provider_ref: ref, ...reqRow });
    } catch (perr) {
      // provider-hiba → koin-visszatérítés a resolve_payout-ban
      await sb.rpc('resolve_payout', {
        p_request: reqRow.request_id,
        p_status: 'failed',
        p_provider_ref: null,
      });
      res.status(502).json({ error: `payout_failed: ${perr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
