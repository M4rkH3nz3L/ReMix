const { loggedFetch } = require('./lib/caught');
// 📊 Usage-metering a workerben (audit §2.2) — a drága felhő-erőforrások havi
// mérése + tier-kvóta ENFORCE-olása. A kvóta-logika AZONOS a kliens
// src/lib/usageMeter.ts-sel (preview/kliens == worker konzisztencia); a tárolás a
// `usage_counters` tábla (service_role írja, a user a sajátját olvassa RLS-sel).
//
// A gate (`enforceQuota`) a drága endpoint ELŐTT kérdez; a `trackUsage` a hívás
// UTÁN könyvel. REDIS/DB nélkül (vagy a tábla hiányában) BEST-EFFORT „megenged"
// degradál — a rate-limit (security/rateLimit.js) a második védvonal.
const { createClient } = require('@supabase/supabase-js');
const { AsyncLocalStorage } = require('async_hooks');
const { activeTierFromRow } = require('./tiers');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const USAGE_METRICS = ['aiTokens', 'renderMinutes', 'exports', 'cloudJobs'];

// Havi kvóták tierenként (-1 = korlátlan). AZONOS a kliens TIER_QUOTAS-szal.
const TIER_QUOTAS = {
  free: { aiTokens: 0, renderMinutes: 0, exports: 15, cloudJobs: 25 },
  basic: { aiTokens: 200000, renderMinutes: 30, exports: 100, cloudJobs: 150 },
  pro: { aiTokens: 1000000, renderMinutes: 120, exports: -1, cloudJobs: -1 },
  ultra: { aiTokens: 3000000, renderMinutes: 400, exports: -1, cloudJobs: -1 },
  business: { aiTokens: 2000000, renderMinutes: 300, exports: -1, cloudJobs: -1 },
};

function quotaFor(tier) {
  return TIER_QUOTAS[tier] || TIER_QUOTAS.free;
}

// A Vállalati csomag legkisebb ülésszáma (PRO-CASH 5.1); a kliens seatQuota tükre.
const BUSINESS_MIN_SEATS = 2;

/** A szervezet KÖZÖS havi kerete: Vállalati = fejenkénti kvóta × ülésszám (min. 2). */
function seatQuota(tier, seats) {
  const q = quotaFor(tier);
  if (tier !== 'business') {
    return q;
  }
  const n = Math.max(BUSINESS_MIN_SEATS, Math.trunc(seats) || BUSINESS_MIN_SEATS);
  const out = { ...q };
  for (const m of USAGE_METRICS) {
    out[m] = q[m] < 0 ? -1 : q[m] * n;
  }
  return out;
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

/**
 * 📊 AI-token metering kontextus. A middleware (`aiMeter`) a verifikált hívó
 * uid-ját teszi ide a kérés idejére; a provider-független `runStructured`
 * (server/ai.js) innen olvassa — így a 9 AI-funkció aláírása változatlan marad,
 * koncurrencia-biztosan (minden kérés külön async-context). Üres store → nincs
 * könyvelés (pl. BYOK vagy lokális provider, amit nem a mi kvótánkba mérünk).
 */
const aiUsageContext = new AsyncLocalStorage();

/**
 * A különféle provider-válaszokból a felhasznált tokenek (input+output).
 * Anthropic: `usage.input_tokens/output_tokens`; OpenAI-kompat.: `usage.total_tokens`
 * vagy `prompt_tokens+completion_tokens`; Ollama: `prompt_eval_count+eval_count`.
 * Ismeretlen alak → 0 (a metering best-effort, sosem dob).
 */
function aiTokenCount(raw) {
  if (!raw || typeof raw !== 'object') {
    return 0;
  }
  const u = raw.usage && typeof raw.usage === 'object' ? raw.usage : raw;
  if (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number') {
    return (u.input_tokens || 0) + (u.output_tokens || 0); // Anthropic
  }
  if (typeof u.total_tokens === 'number') {
    return u.total_tokens; // OpenAI
  }
  if (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number') {
    return (u.prompt_tokens || 0) + (u.completion_tokens || 0); // OpenAI (részletes)
  }
  if (typeof raw.prompt_eval_count === 'number' || typeof raw.eval_count === 'number') {
    return (raw.prompt_eval_count || 0) + (raw.eval_count || 0); // Ollama
  }
  return 0;
}

let admin = null;
function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return null;
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false }, global: { fetch: loggedFetch() } });
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
 * A user AKTUÁLIS tier-je a `subscriptions`-ből — ugyanaz a szabály, mint a billing
 * `activeTier`-é és a DB `active_tier_for`-é (server/tiers.js `activeTierFromRow`).
 * Hiba/nincs/lejárt → `free`. (A kvóta ENFORCE-hoz a HITELES, server-oldali tier kell.)
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
  return activeTierFromRow(data, now.getTime());
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
  seatQuota,
  BUSINESS_MIN_SEATS,
  periodKey,
  remaining,
  canUse,
  isUnlimited,
  getUsage,
  enforceQuota,
  trackUsage,
  userTier,
  aiUsageContext,
  aiTokenCount,
};
