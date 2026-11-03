const { logCaught } = require('../lib/caught');
// 🎬 Reklám route-ok (PRO-CASH C2.2). Domain-router (01-api-architecture §01.1).
//
// GET /ads/ssv — az AdMob szerveroldali ellenőrzésének (SSV) visszahívása a jutalmazott reklám
// végignézése után. NYILVÁNOS (az AdMob hívja, nem a user), de CSAK érvényes Google-aláírással
// ír jóvá; a jutalom a grant_ad_reward-ban (napi limit, tranzakció-idempotencia, bónusz-alegyenleg).

const express = require('express');
const { adminClient } = require('../notify');
const { parseSsvQuery, verifySsv, verifierKeys } = require('../admobSsv');

const router = express.Router();

router.get('/ads/ssv', async (req, res) => {
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'A reklám-jutalom nincs konfigurálva (service_role).' });
    return;
  }
  const raw = (req.originalUrl.split('?')[1] || '').trim();
  const parsed = parseSsvQuery(raw);
  if (!parsed || !parsed.userId || !parsed.transactionId) {
    res.status(400).json({ error: 'invalid_ssv' });
    return;
  }
  try {
    const keys = await verifierKeys();
    if (!verifySsv(parsed, keys)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }
    const { data, error } = await sb.rpc('grant_ad_reward', {
      p_user: parsed.userId,
      p_transaction: parsed.transactionId,
      p_ad_unit: parsed.adUnit || null,
    });
    if (error) {
      throw new Error(error.message);
    }
    // az AdMob a 200-at várja; a duplikátum és a napi limit is 200 (a jutalom nem ismételhető)
    res.json(data);
  } catch (err) {
    logCaught('routes/ads.js', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
