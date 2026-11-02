const { logCaught } = require('../lib/caught');
// 🗑️ Account route (GDPR vegleges torles / hard-erase).
// Domain-router (01-api-architecture §01.1). SZO SZERINT az index.js-bol; env-kapuzott.

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { adminClient } = require('../notify');
const { eraseAccount } = require('../eraseSweep');
const { eraseCooldownElapsed } = require('../security/accountErase');
const { securityEvent } = require('../security/auditLog');

const ALLOW_ERASE = process.env.ALLOW_ACCOUNT_ERASE === '1';

const router = express.Router();

router.post('/account/erase', express.json({ limit: '4kb' }), requireAuth, async (req, res) => {
  if (!ALLOW_ERASE) {
    res.status(403).json({ error: 'A végleges törlés ki van kapcsolva (ALLOW_ACCOUNT_ERASE=1 kell).' });
    return;
  }
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'Admin-kliens (service_role) nincs konfigurálva.' });
    return;
  }
  try {
    // 1) GATING: előbb soft-delete + a visszavonási idő letelte kötelező
    const { data: prof } = await sb
      .from('profiles')
      .select('deleted_at')
      .eq('id', uid)
      .maybeSingle();
    if (!eraseCooldownElapsed(prof?.deleted_at, Date.now())) {
      res.status(400).json({
        error: 'Előbb fiók-deaktiválás (soft-delete) + a visszavonási idő letelte szükséges.',
      });
      return;
    }
    // 2) a saját média a napló alapján, majd az auth-user (cascade a DB-ben)
    const { purgedObjects: purged } = await eraseAccount(sb, uid);
    securityEvent('account.erased', { actor: uid, result: 'ok', meta: { purgedObjects: purged } });
    res.json({ erased: true, purgedObjects: purged });
  } catch (e) {
    logCaught('routes/account.js', e);
    securityEvent('account.erase_failed', { actor: uid, result: 'error', meta: { error: e.message } });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
