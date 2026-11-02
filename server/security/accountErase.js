const { logCaught } = require('../lib/caught');
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

const PAGE = 1000;

/**
 * A fiók média-objektumainak törlése a `storage_objects` napló alapján (PRO-SOCIAL S7). A napló
 * sorát a szerver írja a hitelesített feltöltőhöz, ezért idegen fájl nem kerülhet bele; a korábbi,
 * projekt-ID-ból épített előtag szabadon írható volt, és más user mappájára is mutathatott.
 * Lapoz, így 1000 fájl fölött sem marad ki semmi. A sorokat nem törli: a fiókkal együtt mennek.
 * @param {object} sb service_role kliens
 * @param {(key: string) => Promise<void>} removeObject a tárból töröl
 * @returns {Promise<{purged:number, failed:number}>}
 */
async function purgeUserMedia(sb, uid, removeObject) {
  let [purged, failed, from] = [0, 0, 0];
  for (;;) {
    const { data, error } = await sb
      .from('storage_objects')
      .select('key')
      .eq('user_id', uid)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`storage_objects lekérés sikertelen: ${error.message}`);
    }
    for (const { key } of data ?? []) {
      try {
        await removeObject(key);
        purged += 1;
      } catch (caught) {
        logCaught('security/accountErase.js:purgeUserMedia', caught);
        failed += 1;
      }
    }
    if ((data ?? []).length < PAGE) {
      return { purged, failed };
    }
    from += PAGE;
  }
}

module.exports = {
  eraseCooldownElapsed,
  purgeUserMedia,
  ERASE_COOLDOWN_DAYS,
};
