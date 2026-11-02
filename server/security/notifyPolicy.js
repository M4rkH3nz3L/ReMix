// 🔔 Értesítés-küldés jogosultsága (OWASP API1 — BOLA / API5 — BFLA).
//
// A `/notify` végpont eddig BÁRMELY hitelesített usernek engedte, hogy a kérés
// törzsében megadott TETSZŐLEGES `userId`-nak küldjön push/realtime értesítést
// → névtelen-spam helyett „hitelesített-spam"/phishing vektor maradt (a kód
// maga is TODO-ként jelölte). Ez a modul a PURE szabály: KI küldhet KINEK.
//
// A tényleges kapcsolat-lekérdezést (service_role, RLS-t kerülő) a
// `notify.js` `canNotify()` végzi; ez a döntés viszont adat-mentes és pure →
// önállóan tesztelhető (a repo „pure mag" elve, lásd AGENTS.md).

/**
 * Küldhet-e a hívó értesítést a címzettnek?
 *
 * Engedélyezett, ha:
 *   • saját magának küldi (callerId === recipientId), VAGY
 *   • van közös projektjük (collab: owner↔member kapcsolat), VAGY
 *   • a címzett követi a hívót (social): az egyoldalú követés nem nyit csatornát a címzett felé.
 * A blokk mindent felülír, a saját magának küldést kivéve.
 * Minden más esetben tilos (idegen usernek nem lehet értesítést küldeni).
 *
 * @param {{callerId?:string|null, recipientId?:string|null,
 *          shareProject?:boolean, followEdge?:boolean}} ctx
 * @returns {boolean}
 */
function decideNotify(ctx = {}) {
  const { callerId, recipientId, shareProject, followEdge, blocked } = ctx;
  if (!callerId || !recipientId) {
    return false;
  }
  if (callerId === recipientId) {
    return true;
  }
  return !blocked && (Boolean(shareProject) || Boolean(followEdge));
}

/** A kliens `isSafeNotificationRoute` tükre (szerződésteszt köti össze). */
const ROUTE_PREFIXES = ['/chat/', '/channel/', '/live/', '/collab/'];
const ROUTE_EXACT = ['/devices', '/schedules'];

function isSafeRoute(route) {
  if (typeof route !== 'string' || route.includes('..') || route.includes('://') || route.startsWith('//')) {
    return false;
  }
  return ROUTE_EXACT.includes(route) || ROUTE_PREFIXES.some((p) => route.startsWith(p) && route.length > p.length);
}

module.exports = { decideNotify, isSafeRoute };
