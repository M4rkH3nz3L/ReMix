// 📊 Usage-metering a workerben (audit §2.2) — a drága felhő-erőforrások havi
// mérése + tier-kvóta ENFORCE-olása. A kvóta-logika AZONOS a kliens
// src/lib/usageMeter.ts-sel (preview/kliens == worker konzisztencia); a tárolás a
// `usage_counters` tábla (service_role írja, a user a sajátját olvassa RLS-sel).
//
// A gate (`enforceQuota`) a drága endpoint ELŐTT kérdez; a `trackUsage` a hívás
// UTÁN könyvel. REDIS/DB nélkül (vagy a tábla hiányában) BEST-EFFORT „megenged"
// degradál — a rate-limit (security/rateLimit.js) a második védvonal.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const USAGE_METRICS = ['aiTokens', 'renderMinutes', 'exports', 'cloudJobs'];

// Havi kvóták tierenként (-1 = korlátlan). AZONOS a kliens TIER_QUOTAS-szal.
const TIER_QUOTAS = {
  free: { aiTokens: 20000, renderMinutes: 10, exports: 15, cloudJobs: 25 },
  basic: { aiTokens: 100000, renderMinutes: 60, exports: 100, cloudJobs: 150 },
  pro: { aiTokens: 500000, renderMinutes: 300, exports: -1, cloudJobs: -1 },
  ultra: { aiTokens: -1, renderMinutes: -1, exports: -1, cloudJobs: -1 },
};

function quotaFor(tier) {
  return TIER_QUOTAS[tier] || TIER_QUOTAS.free;
}

/** A dátum havi periódus-kulcsa: `YYYY-MM` (UTC). */
function periodKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function isUnlimited(quota, metric) {
  return (quota[metric] ?? 0) < 0;
}

/** Hátralévő mennyiség (Infinity, ha korlátlan). */
function remaining(used, quota, metric) {
  if (isUnlimited(quota, metric)) {
    return Infinity;
  }
  return Math.max(0, (quota[metric] ?? 0) - (used || 0));
}

/** Belefér-e még `amount` (a már felhasznált `used` fölött). */
function canUse(used, quota, metric, amount = 1) {
  return remaining(used, quota, metric) >= amount;
}

let admin = null;
function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return null;
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  }
  return admin;
}

/** A user adott metrikájának aktuális havi felhasználása (0, ha nincs/hiba). */
async function getUsage(userId, metric, now = new Date()) {
  const sb = getAdmin();
  if (!sb || !userId) {
    return 0;
  }
  const { data, error } = await sb
    .from('usage_counters')
    .select('amount')
    .eq('user_id', userId)
    .eq('period', periodKey(now))
    .eq('metric', metric)
    .maybeSingle();
  if (error || !data) {
    return 0;
  }
  return Number(data.amount) || 0;
}

/**
 * 🔒 Kvóta-ellenőrzés a drága hívás ELŐTT. `{ ok, remaining }`. Ha a tábla/service_role
 * hiányzik (vagy ismeretlen metrika), MEGENGED degradál (a rate-limit a második védvonal).
 */
async function enforceQuota(userId, tier, metric, amount = 1, now = new Date()) {
  if (!USAGE_METRICS.includes(metric)) {
    return { ok: true, remaining: Infinity };
  }
  const quota = quotaFor(tier);
  if (isUnlimited(quota, metric)) {
    return { ok: true, remaining: Infinity };
  }
  const used = await getUsage(userId, metric, now);
  const rem = remaining(used, quota, metric);
  return { ok: rem >= amount, remaining: rem };
}

/**
 * A user AKTUÁLIS tier-je a `subscriptions`-ből (aktív period figyelembevételével).
 * Hiba/nincs/lejárt → `free`. Ma free/pro; a basic/ultra a billing-bekötéssel jön —
 * a kvóta-logika már kész rá. (A kvóta ENFORCE-hoz a HITELES, server-oldali tier kell.)
 */
async function userTier(userId, now = new Date()) {
  const sb = getAdmin();
  if (!sb || !userId) {
    return 'free';
  }
  const { data } = await sb
    .from('subscriptions')
    .select('tier, current_period_end, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data || data.status !== 'active' || !TIER_QUOTAS[data.tier]) {
    return 'free';
  }
  const end = data.current_period_end ? Date.parse(data.current_period_end) : NaN;
  return Number.isNaN(end) || end > now.getTime() ? data.tier : 'free';
}

/** Fogyasztás könyvelése a hívás UTÁN (best-effort, atomikus upsert-increment). */
async function trackUsage(userId, metric, amount, now = new Date()) {
  const sb = getAdmin();
  if (!sb || !userId || !USAGE_METRICS.includes(metric) || !(amount > 0)) {
    return;
  }
  // atomikus növelés az RPC-vel (a tábla + rpc a migrációban); hibát elnyelünk
  const { error } = await sb.rpc('increment_usage', {
    p_user: userId,
    p_period: periodKey(now),
    p_metric: metric,
    p_amount: Math.round(amount),
  });
  if (error) {
    console.warn(`[usage] trackUsage nem sikerült (best-effort): ${error.message}`);
  }
}

module.exports = {
  USAGE_METRICS,
  TIER_QUOTAS,
  quotaFor,
  periodKey,
  remaining,
  canUse,
  isUnlimited,
  getUsage,
  enforceQuota,
  trackUsage,
  userTier,
};
