// 🗄️ Tárhely-kvóta — a MI tárhelyünkön (Supabase `renders` bucket / szerver-média)
// fekvő bájtok elszámolása és a KEMÉNY limit-tiltás szerver-oldali fele.
//
// A hiteles forrás a `storage_objects` napló + a `storage_usage_for` /
// `record_storage_object_for` SECURITY DEFINER függvények (lásd a
// 20260927130000-migrációt). A worker service_role-lal hívja őket. A kliens SAJÁT
// külső forrásán (Drive/Dropbox/WebDAV/S3) fekvő média NEM kerül a naplóba →
// nem terheli a kvótát.
const { adminClient } = require('./notify');

/** A limit-túllépés jelzője → az endpoint 507-et ad rá. */
class QuotaExceededError extends Error {
  constructor(usage) {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
    this.usage = usage || null;
  }
}

function quotaAvailable() {
  return !!adminClient();
}

/** A user aktuális használata/kvótája (jsonb), vagy null, ha nincs service_role. */
async function usageFor(userId) {
  const sb = adminClient();
  const uid = String(userId || '').trim();
  if (!sb || !uid) {
    return null;
  }
  const { data, error } = await sb.rpc('storage_usage_for', { p_user: uid });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * A fájl felvétele a naplóba KVÓTA-ELLENŐRZÉSSEL. A `record_storage_object_for`
 * atomikusan ellenőriz + beszúr; limit-túllépéskor `quota_exceeded`-et dob, amit
 * `QuotaExceededError`-ré fordítunk. Visszaadja a friss használatot.
 */
async function recordObject(userId, { projectId = null, bucket = 'renders', key, bytes, source = 'server' }) {
  const sb = adminClient();
  const uid = String(userId || '').trim();
  if (!sb || !uid) {
    return null; // dev / nincs service_role → best-effort, nem számolunk
  }
  const { data, error } = await sb.rpc('record_storage_object_for', {
    p_user: uid,
    p_bucket: bucket,
    p_key: key,
    p_bytes: Math.max(0, Math.trunc(Number(bytes) || 0)),
    p_project_id: projectId,
    p_source: source,
  });
  if (error) {
    if (/quota_exceeded/i.test(error.message)) {
      throw new QuotaExceededError(await usageFor(uid).catch(() => null));
    }
    throw new Error(error.message);
  }
  return data;
}

/**
 * Előzetes ellenőrzés a feltöltés ELŐTT (hogy ne töltsünk fel feleslegesen): a
 * jelenlegi használat + a bejövő bájt túllépné-e a kvótát. Nem hiteles enforcement
 * (az a `recordObject`), csak gyors, felhasználóbarát elutasítás.
 */
async function wouldExceed(userId, incomingBytes) {
  const usage = await usageFor(userId).catch(() => null);
  if (!usage) {
    return { exceeded: false, usage: null };
  }
  const used = Number(usage.used_bytes || 0);
  const quota = Number(usage.quota_bytes || 0);
  return { exceeded: used + Math.max(0, Number(incomingBytes) || 0) > quota, usage };
}

module.exports = { QuotaExceededError, quotaAvailable, usageFor, recordObject, wouldExceed };
