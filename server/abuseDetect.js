'use strict';

/**
 * 🛡️ Erőforrás-abuse detektálás — PURE velocity-mag (Monetization §06.2).
 *
 * A metering (usage.js) best-effort megengedő DB-hiány esetén → a rate-limit
 * (security/rateLimit.js) a 2. védvonal, EZ a 3.: erőforrás-specifikus burst-minta
 * az esemény-időbélyegekből (AI-token-burst, render-spam, upload-flood, storage-
 * kvóta-kerülgetés). A döntés TISZTA függvény (az esemény-listát a hívó adja a
 * usage_counters / egy event-store alapján), így unit-tesztelt. A küszöb
 * tier-arányosan skálázódik (2^rang), hogy a legit Pro/Ultra/Business ne akadjon be.
 * A tier-nevek a kanonikus ./tiers TIER_ORDER-ből jönnek → nincs drift.
 */

const { asTier, tierRank } = require('./tiers');

/**
 * Per-metrika alap-küszöbök (free-tier, 60 mp-es csúszóablak).
 * warn → fokozatos throttle, block → ideiglenes blokk.
 */
const ABUSE_RULES = {
  ai: { windowMs: 60_000, warn: 30, block: 60 }, // AI-hívás / perc
  render: { windowMs: 60_000, warn: 10, block: 20 }, // render-job / perc
  upload: { windowMs: 60_000, warn: 50, block: 120 }, // feltöltés / perc
  storage: { windowMs: 60_000, warn: 200, block: 500 }, // tár-művelet / perc
};

/** Tier-szorzó: 2^rang → free×1, basic×2, pro×4, ultra×8, business×16. */
function tierMultiplier(tier) {
  return Math.pow(2, tierRank(asTier(tier)));
}

/** Hány esemény esik a [nowMs − windowMs, nowMs] csúszóablakba. */
function countWithinWindow(timestamps, nowMs, windowMs) {
  if (!Array.isArray(timestamps)) {
    return 0;
  }
  let n = 0;
  for (const t of timestamps) {
    const ts = Number(t);
    if (Number.isFinite(ts) && ts <= nowMs && nowMs - ts <= windowMs) {
      n += 1;
    }
  }
  return n;
}

/** A metrika effektív küszöbei az adott tierre (alap × tier-szorzó). */
function abuseThresholds(metric, tier) {
  const rule = ABUSE_RULES[metric];
  if (!rule) {
    return null;
  }
  const mult = tierMultiplier(tier);
  return {
    windowMs: rule.windowMs,
    warn: rule.warn * mult,
    block: rule.block * mult,
  };
}

/**
 * Az abuse-döntés az esemény-időbélyegek alapján.
 * @returns {{action:'allow'|'throttle'|'block', reason:string, count:number, warn?:number, block?:number}}
 */
function abuseDecision({ metric, timestamps, nowMs, tier } = {}) {
  const th = abuseThresholds(metric, tier);
  if (!th) {
    return { action: 'allow', reason: 'no_rule', count: 0 };
  }
  const count = countWithinWindow(timestamps, nowMs, th.windowMs);
  if (count >= th.block) {
    return { action: 'block', reason: `${metric}_block`, count, warn: th.warn, block: th.block };
  }
  if (count >= th.warn) {
    return { action: 'throttle', reason: `${metric}_throttle`, count, warn: th.warn, block: th.block };
  }
  return { action: 'allow', reason: 'ok', count, warn: th.warn, block: th.block };
}

/**
 * Tár-kvóta-kerülgetés: sok apró fájl (kvóta-byte alatti) → gyanús.
 * @returns {boolean} legalább minCount darab maxBytes-nál kisebb fájl.
 */
function smallFileAbuse(sizes, { maxBytes = 1024, minCount = 100 } = {}) {
  if (!Array.isArray(sizes)) {
    return false;
  }
  let small = 0;
  for (const s of sizes) {
    const b = Number(s);
    if (Number.isFinite(b) && b >= 0 && b <= maxBytes) {
      small += 1;
    }
  }
  return small >= minCount;
}

module.exports = {
  ABUSE_RULES,
  tierMultiplier,
  countWithinWindow,
  abuseThresholds,
  abuseDecision,
  smallFileAbuse,
};
