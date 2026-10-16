'use strict';

/**
 * 🤖 Bot / farming heurisztika — PURE mag (Monetization §06.3).
 *
 * A pénzmozgató és növekedés-érzékeny utak (signup, gift/promo-spam, payout-farming)
 * gyanús mintái. A klaszterezés gráf-jellegű (sok fiók → EGY közös kulcs: payout-cél
 * / eszköz / IP), amit az abuseDetect velocity-magja nem fed. A velocity-spike-hoz
 * az abuseDetect csúszóablakát használjuk újra (nincs duplikáció). TISZTA függvények
 * (a hívó adja a linkeket/időbélyegeket) → unit-tesztelt. A döntés SZERVER-oldali;
 * a gyanús fiók a pénz-utakon korlátozható. Lásd [[abuseDetect]].
 */

const { countWithinWindow } = require('./abuseDetect');

/**
 * Megosztott-kulcs klaszterek: ahány KÜLÖNBÖZŐ user ugyanazt a kulcsot (payout-cél /
 * device-fingerprint / IP) használja. minUsers-nél több → gyanús klaszter.
 * @param {Array<{userId:string, key:string}>} links
 * @returns {{clusters:Array<{key:string,users:string[],count:number}>, flagged:string[], suspicious:boolean}}
 */
function clusterByShared(links, { minUsers = 3 } = {}) {
  const byKey = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || l.key == null || l.userId == null) {
      continue;
    }
    const key = String(l.key);
    if (!byKey.has(key)) {
      byKey.set(key, new Set());
    }
    byKey.get(key).add(String(l.userId));
  }
  const clusters = [];
  for (const [key, users] of byKey) {
    if (users.size >= minUsers) {
      clusters.push({ key, users: [...users], count: users.size });
    }
  }
  clusters.sort((a, b) => b.count - a.count);
  return { clusters, flagged: clusters.map((c) => c.key), suspicious: clusters.length > 0 };
}

/**
 * Payout-farming: sok fiók → egy payout-cél. (clusterByShared alias a célzott
 * használatra; a `key` a payout-cél, pl. PayPal-email.)
 */
function payoutFarmingRisk(links, opts = {}) {
  return clusterByShared(links, { minUsers: 3, ...opts });
}

/**
 * Velocity-spike egy fiók/IP akcióira (signup / gift / promo-beváltás spam).
 * @returns {{spike:boolean, count:number, max:number}}
 */
function velocitySpike(timestamps, nowMs, { windowMs = 60_000, max = 10 } = {}) {
  const count = countWithinWindow(timestamps, nowMs, windowMs);
  return { spike: count > max, count, max };
}

module.exports = { clusterByShared, payoutFarmingRisk, velocitySpike };
