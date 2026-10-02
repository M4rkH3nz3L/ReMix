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
 * - nincs tulajdonos (ownerId == null): dev/legacy job, amit nem tudunk a
 *   tokenhez kötni → nem korlátozzuk (prod-ban a /render mindig beállítja az
 *   ownert a verifikált tokenből, tehát ott sosem null).
 * - van tulajdonos: a hívónak AZONOSÍTHATÓNAK és EGYEZŐNEK kell lennie.
 *
 * @param {string|null|undefined} ownerId a job tulajdonosa (job.userId)
 * @param {string|null|undefined} callerId a verifikált hívó (req.user?.id)
 * @returns {boolean}
 */
function canAccessRenderJob(ownerId, callerId) {
  if (ownerId === null || ownerId === undefined || ownerId === '') {
    return true;
  }
  return callerId != null && callerId !== '' && ownerId === callerId;
}

module.exports = { canAccessRenderJob };
