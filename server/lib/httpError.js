// 🧯 Egységes HTTP-hiba- és válasz-kontraktus (01-api-architecture §01.3).
//
// A route-ok `throw httpError(status, msg, { code, issues })`-t dobnak (vagy
// `next(err)`-t), és a lánc VÉGÉN álló `errorHandler` egységes JSON-alakra hozza:
//   { error: string, code?: string, issues?: [] }
// Így nincs route-onként szórt `res.status(...).json({error})` boilerplate, és
// soha nem szivárog nyers HTML/stack a kliensnek.

/** Egységes, státusz-hordozó hiba. A `status` a HTTP-kód, a `publicMessage` a
 *  kliensnek megjelenő szöveg (az 5xx-nél elnyeljük a belső üzenetet). */
class HttpError extends Error {
  constructor(status, message, opts = {}) {
    super(message || 'Hiba');
    this.name = 'HttpError';
    this.status = Number.isInteger(status) ? status : 500;
    this.expose = true; // ez SZÁNDÉKOS, kliensnek szánt üzenet (nem belső 500)
    if (opts.code) {
      this.code = opts.code;
    }
    if (opts.issues) {
      this.issues = opts.issues;
    }
  }
}

/** Gyártó: `throw httpError(400, 'Érvénytelen kérés.', { code, issues })`. */
function httpError(status, message, opts = {}) {
  return new HttpError(status, message, opts);
}

/** A kérés végén álló hiba-middleware. Négy-paraméteres → Express ezt
 *  hiba-handlerként ismeri fel. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // ha a válasz már elindult (pl. sendFile közben hiba), Express zárja le
  if (res.headersSent) {
    return res.end();
  }
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  // 5xx: a belső hibaüzenetet NEM szivárogtatjuk (csak a szándékos HttpError-t)
  const exposed = err && err.expose === true;
  const message =
    status < 500 || exposed ? (err && err.message) || 'Hiba' : 'Szerverhiba.';
  const body = { error: message };
  if (err && err.code) {
    body.code = err.code;
  }
  if (err && err.issues) {
    body.issues = err.issues;
  }
  res.status(status).json(body);
}

module.exports = { HttpError, httpError, errorHandler };
