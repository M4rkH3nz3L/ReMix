// 🗑️ Account route (GDPR vegleges torles / hard-erase).
// Domain-router (01-api-architecture §01.1). SZO SZERINT az index.js-bol; env-kapuzott.

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { adminClient } = require('../notify');
const { eraseCooldownElapsed, storagePrefixes, listAllObjects } = require('../security/accountErase');

const ALLOW_ERASE = process.env.ALLOW_ACCOUNT_ERASE === '1';
const ERASE_BUCKET = process.env.MEDIA_BUCKET || 'renders';

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
    // 2) STORAGE-média purge (best-effort) — a user projektjeinek objektumai
    let purged = 0;
    try {
      const { data: projs } = await sb
        .from('cloud_projects')
        .select('project_id')
        .eq('user_id', uid);
      const storage = sb.storage.from(ERASE_BUCKET);
      for (const prefix of storagePrefixes((projs || []).map((p) => p.project_id))) {
        const paths = await listAllObjects(storage, prefix);
        if (paths.length > 0) {
          await storage.remove(paths);
          purged += paths.length;
        }
      }
    } catch (e) {
      console.warn('[erase] storage-purge részleges:', e.message);
    }
    // 3) AUTH-felhasználó törlése → cascade a DB-ben (profiles/posts/…)
    const { error: delErr } = await sb.auth.admin.deleteUser(uid);
    if (delErr) {
      throw new Error(`auth-user törlés sikertelen: ${delErr.message}`);
    }
    securityEvent('account.erased', { actor: uid, result: 'ok', meta: { purgedObjects: purged } });
    res.json({ erased: true, purgedObjects: purged });
  } catch (e) {
    securityEvent('account.erase_failed', { actor: uid, result: 'error', meta: { error: e.message } });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
