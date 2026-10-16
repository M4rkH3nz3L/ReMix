#!/usr/bin/env node
// 🗑️ GDPR hard-erase cron (03-production §03.4). A lejárt-cooldownú soft-delete-elt
// fiókokat véglegesen törli (storage-média purge + auth-user delete + audit).
//
// Futtatás (napi, pl. host-cron vagy compose-sidecar):
//   ALLOW_ACCOUNT_ERASE=1 SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/erase-cron.js
//
// ⚠️ DESTRUKTÍV → env-kapuzott (ALLOW_ACCOUNT_ERASE=1) + service_role kell; a cooldown
// (ERASE_COOLDOWN_DAYS, alap 14) letelte UTÁN töröl. Exit: 0 ok, 1 részleges/hiba,
// 2 kikapcsolt, 3 nincs service_role.

const { adminClient } = require('../notify');
const { sweepExpiredErasures } = require('../eraseSweep');

async function main() {
  if (process.env.ALLOW_ACCOUNT_ERASE !== '1') {
    console.error('[erase-cron] KI van kapcsolva — ALLOW_ACCOUNT_ERASE=1 kell. Kihagyva.');
    process.exit(2);
  }
  const sb = adminClient();
  if (!sb) {
    console.error('[erase-cron] nincs service_role (SUPABASE_SERVICE_ROLE_KEY) — kihagyva.');
    process.exit(3);
  }
  const r = await sweepExpiredErasures({ sb });
  console.log(`[erase-cron] kész — eligible=${r.eligible} erased=${r.erased} failed=${r.failed}`);
  process.exit(r.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[erase-cron] végzetes hiba:', e.message);
  process.exit(1);
});
