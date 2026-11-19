// 🛑 Render-tartalom hibák és az effekt-szintű visszaesések jelentése. (A server/render.js-ből kiemelve.)

/**
 * 🛑 A render nem adhat ki hiányos tartalmat csendben: ha a szöveg / felirat / forma / beágyazott kompozíció nem
 * készíthető el, a job érthető hibával bukik (eddig a videó „sikeresen" elkészült szöveg nélkül — MO-B2).
 */
class RenderContentError extends Error {
  constructor(part, cause) {
    const what = { text: 'a szövegek és feliratok', shape: 'a formák', compound: 'egy beágyazott kompozíció' }[part] || part;
    super(`A videó nem készült el: ${what} nem renderelhetők (${cause && cause.message ? cause.message : 'ismeretlen hiba'}).`);
    this.name = 'RenderContentError';
    this.part = part;
  }
}

/**
 * Az effekt-szintű visszaesések listája (a videó elkészül, de egyszerűsítve) — a job eredménye hozza, a kliens
 * jelzi. Kulcsok: textMotion (animált szöveg állóként), pathAnim (mozgó forma állóként), mask (animált maszk
 * közelítéssel), particles (részecskék nélkül).
 */
function noteDegraded(report, key) {
  if (!report) return;
  report.degraded = report.degraded || [];
  if (!report.degraded.includes(key)) report.degraded.push(key);
}

module.exports = {
  RenderContentError,
  noteDegraded,
};
