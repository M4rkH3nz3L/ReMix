// 🎬 Render-job ownership (OWASP API1 — Broken Object Level Authorization).
//
// A `/render/:id` (státusz) és `/render/:id/file` (letöltés) eddig AUTH NÉLKÜL,
// ownership-ellenőrzés nélkül futott → bárki, aki ismer/kitalál egy job-id-t,
// lekérhette más renderjét. Ez tankönyvi BOLA. Ez a pure döntés-függvény a
// hívó és a job tulajdonosának összevetéséből dönt (a hívó middleware tölti a
// req.user-t a tokenből — header VAGY `?t=` query-token).

/**
 * Hozzáférhet-e `callerId` a `ownerId`-hoz tartozó render-jobhoz?
 *
 * - nincs tulajdonos (ownerId == null): csak `allowOwnerless` (insecure-dev) módban
 *   érhető el — prod-ban minden job (render, proxy, collect) a verifikált hívóé, a
 *   tulajdonos nélküli job tehát hiba/legacy → ELZÁRVA (B26: eddig ID birtokában
 *   bárki letölthette a proxy-videót / a projekt-csomagot).
 * - van tulajdonos: a hívónak AZONOSÍTHATÓNAK és EGYEZŐNEK kell lennie.
 *
 * @param {string|null|undefined} ownerId a job tulajdonosa (job.userId)
 * @param {string|null|undefined} callerId a verifikált hívó (req.user?.id)
 * @param {boolean} [allowOwnerless] insecure-dev: a tulajdonos nélküli job elérhető
 * @returns {boolean}
 */
function canAccessRenderJob(ownerId, callerId, allowOwnerless = false) {
  if (ownerId === null || ownerId === undefined || ownerId === '') {
    return allowOwnerless === true;
  }
  return callerId != null && callerId !== '' && ownerId === callerId;
}

module.exports = { canAccessRenderJob };
