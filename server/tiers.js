// 💠 Tier-rangsor — a kliens src/lib/tiers.ts SZERVER-tükre (függőség-mentes).
// A kettőt a src/lib/contract.test.ts zárolja. A gate-logika rang szerint dönt:
// free < basic < pro < ultra < business. (Csomag-nevek: Free/Amatőr/Haladó/Profi/Céges.)
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

module.exports = { TIER_ORDER, tierRank, tierMeetsMin, isPaidTier, asTier };
