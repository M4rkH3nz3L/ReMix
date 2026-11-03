// 💠 Tier-rangsor — a kliens src/lib/tiers.ts SZERVER-tükre (függőség-mentes).
// A kettőt a src/lib/contract.test.ts zárolja. A gate-logika rang szerint dönt:
// free < basic < pro < ultra < business. (Csomag-nevek: Free/Amatőr/Haladó/Profi/Vállalati.)
const TIER_ORDER = ['free', 'basic', 'pro', 'ultra', 'business'];

function tierRank(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? 0 : i;
}

/** Eléri-e a userTier legalább a minTier-t? */
function tierMeetsMin(userTier, minTier) {
  return tierRank(userTier) >= tierRank(minTier);
}

/** Fizetős szint-e (bármi a free fölött)? */
function isPaidTier(tier) {
  return tierRank(tier) > 0;
}

/** Normalizálás ismeretlen bemenetről a legközelebbi érvényes tierre (free). */
function asTier(value) {
  return typeof value === 'string' && TIER_ORDER.includes(value) ? value : 'free';
}

// Aktív előfizetési státuszok (a DB `active_tier_for` tükre).
const ACTIVE_STATUSES = ['active', 'trialing'];

/**
 * A HITELES aktív szint egy `subscriptions`-sorból (a DB `active_tier_for` tükre):
 * aktív státusz ÉS nem lejárt periódus → a sor szintje; FAIL-CLOSED: hiányzó/hibás
 * lejárat, ismeretlen státusz → 'free'. A kliens tükre: src/lib/tiers.ts `activeTierFromRow`.
 */
function activeTierFromRow(row, nowMs = Date.now()) {
  if (!row || !ACTIVE_STATUSES.includes(row.status)) {
    return 'free';
  }
  const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
  if (Number.isNaN(end) || end <= nowMs) {
    return 'free';
  }
  return asTier(row.tier);
}

module.exports = { TIER_ORDER, ACTIVE_STATUSES, tierRank, tierMeetsMin, isPaidTier, asTier, activeTierFromRow };
