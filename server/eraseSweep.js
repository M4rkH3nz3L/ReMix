// 🗑️ GDPR hard-erase SWEEP (03-production §03.4): a lejárt-cooldownú soft-delete-elt
// fiókok VÉGLEGES törlése — ütemezetten (napi cron / compose-sidecar), service_role-lal.
//
// A `/account/erase` endpoint EGY fiókot töröl (a sajátját); ez a sweep az ÖSSZES lejárt
// soft-delete-et végigveszi. A per-fiók törlés ugyanaz: storage-média purge + auth-user
// delete (cascade a DB-re) + audit. A gating-logika (cooldown) a security/accountErase-ből.
//
// SZÁNDÉKOSAN injektálható (sb/now/erase) → a selector + az orchestrator hálózat nélkül
// tesztelhető; a destruktív storage/auth-hívás a valós service_role-kliensen fut (staging).

const { eraseCooldownElapsed, storagePrefixes, listAllObjects } = require('./security/accountErase');
const { securityEvent } = require('./security/auditLog');

const ERASE_BUCKET = process.env.MEDIA_BUCKET || 'renders';

/**
 * PURE: a soft-delete-elt profilokból a VÉGLEGESEN törölhetők (lejárt cooldown) uid-jai.
 * @param {Array<{id?:string, deleted_at?:string|number|null}>} profiles
 * @param {number} nowMs
 * @returns {string[]}
 */
function eligibleForErase(profiles, nowMs) {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && p.id && eraseCooldownElapsed(p.deleted_at, nowMs))
    .map((p) => p.id);
}

/**
 * Egy fiók hard-erase-e: storage-média purge (best-effort) + auth-user delete (cascade).
 * Dob, ha az auth-user törlése nem sikerül (a sweep ezt failed-ként könyveli).
 * @returns {Promise<{purgedObjects:number}>}
 */
async function eraseAccount(sb, uid, bucket = ERASE_BUCKET) {
  let purged = 0;
  try {
    const { data: projs } = await sb.from('cloud_projects').select('project_id').eq('user_id', uid);
    const storage = sb.storage.from(bucket);
    for (const prefix of storagePrefixes((projs || []).map((p) => p.project_id))) {
      const paths = await listAllObjects(storage, prefix);
      if (paths.length > 0) {
        await storage.remove(paths);
        purged += paths.length;
      }
    }
  } catch (e) {
    console.warn('[erase-sweep] storage-purge részleges:', e.message);
  }
  const { error } = await sb.auth.admin.deleteUser(uid);
  if (error) {
    throw new Error(`auth-user törlés sikertelen: ${error.message}`);
  }
  return { purgedObjects: purged };
}

/**
 * Orchestrator: lekéri a soft-delete-elt fiókokat, a lejárt-cooldownúakat hard-erase-eli,
 * minden törlésről audit-eseményt ír. Injektálható deps (teszthez).
 * @returns {Promise<{eligible:number, erased:number, failed:number}>}
 */
async function sweepExpiredErasures({ sb, now = Date.now(), bucket = ERASE_BUCKET, erase = eraseAccount } = {}) {
  if (!sb) {
    return { eligible: 0, erased: 0, failed: 0 };
  }
  const { data: profiles, error } = await sb
    .from('profiles')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null);
  if (error) {
    throw new Error(`profiles lekérés sikertelen: ${error.message}`);
  }
  const uids = eligibleForErase(profiles, now);
  let erased = 0;
  let failed = 0;
  for (const uid of uids) {
    try {
      const r = await erase(sb, uid, bucket);
      securityEvent('account.erased', { actor: uid, result: 'ok', meta: { via: 'cron', purgedObjects: r?.purgedObjects ?? 0 } });
      erased += 1;
    } catch (e) {
      securityEvent('account.erase_failed', { actor: uid, result: 'error', meta: { via: 'cron', error: e.message } });
      failed += 1;
    }
  }
  return { eligible: uids.length, erased, failed };
}

module.exports = { eligibleForErase, eraseAccount, sweepExpiredErasures, ERASE_BUCKET };
