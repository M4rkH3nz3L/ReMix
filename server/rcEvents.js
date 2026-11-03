// 🧾 RevenueCat-esemény → teendő (PRO-CASH C0.5). TISZTA függvény: a billing.js csak
// végrehajtja a tervet, így minden eseménytípus hálózat nélkül tesztelhető.
//
// Termékek (az App Store Connect / Play Console / RevenueCat azonosítói):
//   • Coin-csomag (consumable): `coins_<n>` — n Coin a VÁSÁROLT alegyenlegre, a csomag
//     bónusza a BÓNUSZ-alegyenlegre (PRO-CASH 2.1). A csomagok listája a kliens
//     src/lib/coins.ts COIN_PACKS tükre (a contract.test.ts zárolja).
//   • Áruházi előfizetés: `remix_<basic|pro|ultra>_<monthly|annual>` — a szint ebből jön.
//     A Vállalati nem áruházi termék (szervezeti szerződés, 4. fázis).
// A webhook CSAK ezeket a saját termékeket írja; ismeretlen termékre nem csinál semmit.
//
// Visszatérítés: a RevenueCatnek NINCS `REFUND` eseménye. A visszatérítés `CANCELLATION`
// esemény `cancel_reason: 'CUSTOMER_SUPPORT'` értékkel (előfizetésnél és consumable-nél is).
// Sima lemondásnál (UNSUBSCRIBE, BILLING_ERROR …) a hozzáférés a lejáratig megmarad,
// a visszavonást az `EXPIRATION` hozza.

// [id, Coin, bónusz-Coin] — a kliens COIN_PACKS tükre
const COIN_PACKS = [
  ['coins_1', 1, 0],
  ['coins_5', 5, 0],
  ['coins_10', 10, 0.5],
  ['coins_25', 25, 2],
  ['coins_50', 50, 5],
];

const GRANT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

const REFUND_REASON = 'CUSTOMER_SUPPORT';

/** A Coin-csomag (cent-Coinban), vagy null, ha a termék nem Coin-csomag. */
function coinPackFor(productId) {
  const p = COIN_PACKS.find(([id]) => id === productId);
  return p ? { id: p[0], cents: p[1] * 100, bonusCents: Math.round(p[2] * 100) } : null;
}

/** Az áruházi előfizetés szintje és periódusa, vagy null, ha nem a mi előfizetésünk. */
function subscriptionProduct(productId) {
  const m = /^remix_(basic|pro|ultra)_(monthly|annual)$/.exec(String(productId || ''));
  return m ? { tier: m[1], period: m[2] } : null;
}

/**
 * Egy RevenueCat-esemény terve. Alakok:
 *   { action: 'coins', cents, bonusCents, product }
 *   { action: 'coins_refund', cents, product }          (a csomag + bónusz visszavonása)
 *   { action: 'grant', tier, until }                    (until: ms vagy null)
 *   { action: 'revoke', status: 'expired'|'canceled' }
 *   { action: 'ignore', reason }
 */
function planRevenueCatEvent(ev) {
  const type = ev && ev.type;
  const product = String((ev && ev.product_id) || '');
  const pack = coinPackFor(product);
  const sub = subscriptionProduct(product);

  if (pack) {
    if (type === 'NON_RENEWING_PURCHASE' || type === 'INITIAL_PURCHASE') {
      return { action: 'coins', cents: pack.cents, bonusCents: pack.bonusCents, product };
    }
    if (type === 'CANCELLATION' && ev.cancel_reason === REFUND_REASON) {
      return { action: 'coins_refund', cents: pack.cents + pack.bonusCents, product };
    }
    return { action: 'ignore', reason: `coins:${type || 'unknown'}` };
  }

  if (!sub) {
    return { action: 'ignore', reason: `unknown_product:${product || '-'}` };
  }
  if (GRANT_TYPES.has(type)) {
    const until = Number.isFinite(Number(ev.expiration_at_ms)) && ev.expiration_at_ms != null ? Number(ev.expiration_at_ms) : null;
    return { action: 'grant', tier: sub.tier, until };
  }
  if (type === 'EXPIRATION') {
    return { action: 'revoke', status: 'expired' };
  }
  if (type === 'CANCELLATION' && ev.cancel_reason === REFUND_REASON) {
    return { action: 'revoke', status: 'canceled' };
  }
  // CANCELLATION (lemondás), BILLING_ISSUE, SUBSCRIPTION_PAUSED, TRANSFER …: a hozzáférés a
  // lejáratig megmarad; a lejáratot a következő EXPIRATION/RENEWAL dönti el.
  return { action: 'ignore', reason: `subscription:${type || 'unknown'}` };
}

module.exports = { COIN_PACKS, REFUND_REASON, coinPackFor, subscriptionProduct, planRevenueCatEvent };
