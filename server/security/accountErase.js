// 🗑️ GDPR hard-erasure (devs/tasks/remix/09). A soft-delete (profiles.deleted_at)
// VISSZAÁLLÍTHATÓ; ez a VÉGLEGES törlés a visszavonási (cooldown) idő letelte után:
// a user storage-médiája (a ~5% gap, amit az auth.users cascade NEM töröl) + az
// auth-felhasználó (ami cascade-eli a DB-t) + audit.
//
// ⚠️ DESTRUKTÍV és itt nem tesztelhető → a tiszta GATING-logika (cooldown) tesztelt,
// az endpoint env-kapuzva (ALLOW_ACCOUNT_ERASE) KI van kapcsolva alapból, és csak a
// SAJÁT fiókot törli (uid a verifikált tokenből), a cooldown letelte UTÁN.

const ERASE_COOLDOWN_DAYS = parseInt(process.env.ERASE_COOLDOWN_DAYS || '14', 10);
const DAY_MS = 24 * 3600 * 1000;

/**
 * Letelt-e a visszavonási idő a soft-delete (deleted_at) óta? Csak akkor engedjük
 * a VÉGLEGES törlést, ha a fiók MÁR soft-deletelt ÉS a cooldown letelt.
 * @param {string|number|null|undefined} deletedAt profiles.deleted_at (ISO vagy ms)
 * @param {number} nowMs
 * @param {number} cooldownDays
 * @returns {boolean}
 */
function eraseCooldownElapsed(deletedAt, nowMs, cooldownDays = ERASE_COOLDOWN_DAYS) {
  if (!deletedAt) {
    return false; // nincs soft-delete → nem törölhető véglegesen
  }
  const t = typeof deletedAt === 'number' ? deletedAt : Date.parse(deletedAt);
  if (!Number.isFinite(t)) {
    return false;
  }
  return nowMs - t >= Math.max(0, cooldownDays) * DAY_MS;
}

/** A user storage-prefixei a renders bucketben: projekt-id-nként egy mappa. */
function storagePrefixes(projectIds) {
  return (Array.isArray(projectIds) ? projectIds : [])
    .filter((id) => typeof id === 'string' && id.length > 0)
    .map((id) => `${id}/`);
}

/**
 * Rekurzív listázás a storage-ban egy prefix alatt → a teljes objektum-útvonalak
 * lapos listája (a kulcs `<projectId>/<kind>/<fájl>`, tehát 2 szint). Best-effort:
 * bármilyen hiba esetén a részeredménnyel tér vissza (a törlés sosem dobhat).
 * @param {object} storage a service_role storage-kliens (sb.storage.from(bucket))
 */
async function listAllObjects(storage, prefix, depth = 0) {
  if (!storage || depth > 4) {
    return [];
  }
  let entries = [];
  try {
    const { data } = await storage.list(prefix.replace(/\/$/, ''), { limit: 1000 });
    entries = data || [];
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = `${prefix.replace(/\/$/, '')}/${e.name}`;
    // Supabase storage: a MAPPÁKnak nincs `id`-juk (null); a FÁJLoknak van
    if (e.id) {
      out.push(full);
    } else {
      out.push(...(await listAllObjects(storage, full, depth + 1)));
    }
  }
  return out;
}

module.exports = {
  eraseCooldownElapsed,
  storagePrefixes,
  listAllObjects,
  ERASE_COOLDOWN_DAYS,
};
