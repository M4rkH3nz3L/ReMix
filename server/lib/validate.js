// ✅ Séma-vezérelt input-validáció (01-api-architecture §01.2).
//
// `unknown → zod schema → typed` a vak `req.body.x`/`as SomeType` helyett
// (audit §12.1). Hibánál egységes `400 { error, code:'validation', issues }` a
// közös errorHandleren át (lib/httpError). A validált adat visszaíródik a
// `req[source]`-be (JSON-body), illetve multipart esetén a `req.valid[field]`-be.

const { httpError } = require('./httpError');

/** zod-issue → kompakt, kliens-barát alak (path + message). */
function toIssues(error) {
  return (error.issues || []).map((i) => ({
    path: Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? ''),
    message: i.message,
  }));
}

/**
 * Middleware: a `req[source]` (alapért. 'body') sémára illesztése. Siker esetén a
 * PARSZOLT (típusos, default-olt) adat visszaíródik; hiba esetén `next(400)`.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        httpError(400, 'Érvénytelen kérés.', { code: 'validation', issues: toIssues(result.error) })
      );
    }
    req[source] = result.data;
    next();
  };
}

/**
 * Middleware multipart route-okhoz: a `req.body[field]` JSON-STRING mezőt
 * parszolja és sémára illeszti (pl. `/render` `project`/`settings`/`uriMap`, a
 * `/sampler` `steps`). A parszolt érték a `req.valid[field]`-be kerül (a nyers
 * `req.body[field]` string érintetlen marad a visszafelé-kompatibilitásért).
 * `opts.optional` → hiányzó mezőnél átenged.
 */
function validateJsonField(field, schema, opts = {}) {
  return (req, _res, next) => {
    const raw = req.body ? req.body[field] : undefined;
    if (raw == null || raw === '') {
      if (opts.optional) {
        return next();
      }
      return next(httpError(400, `Hiányzó mező: ${field}.`, { code: 'validation' }));
    }
    let obj;
    try {
      obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return next(httpError(400, `Hibás ${field} JSON.`, { code: 'validation' }));
    }
    const result = schema.safeParse(obj);
    if (!result.success) {
      return next(
        httpError(400, 'Érvénytelen kérés.', { code: 'validation', issues: toIssues(result.error) })
      );
    }
    req.valid = req.valid || {};
    req.valid[field] = result.data;
    next();
  };
}

module.exports = { validate, validateJsonField, toIssues };
