// 🔐 Megosztott HTTP-guardok — kiemelve az index.js-ből (01-api-architecture §01.1).
//
// Szerver-hiteles Pro/Paid-kapu, AI-token-metering, render-job „puha" auth és a
// dev-billing kapu. A VISELKEDÉS VÁLTOZATLAN: a bodyk szó szerint az eredeti
// index.js-ből valók, csak a függőségek most explicit require-rel jönnek.

const { requireAuth, verifyToken, callerId, INSECURE_DEV } = require('../auth');
const { isPro, isPaid } = require('../billing');
const { sanitizeAiConfig, aiProvider } = require('../ai');
const { enforceQuota, userTier, aiUsageContext } = require('../usage');

/**
 * 💳 SZERVER-HITELES Pro-kapu. A kliens `ensureCloud()`-ja csak UX; ez a
 * middleware a `subscriptions` táblából dönt a VERIFIKÁLT token user-ére.
 */
function requirePro(req, res, next) {
  if (INSECURE_DEV) {
    next();
    return;
  }
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  isPro(uid)
    .then((pro) => {
      if (pro) {
        next();
        return;
      }
      res.status(402).json({ error: 'Ehhez a funkcióhoz Pro-előfizetés szükséges.', pro: true });
    })
    .catch(() => res.status(402).json({ error: 'Az előfizetés nem ellenőrizhető.', pro: true }));
}

/** rövidítés: hitelesítés + szerver-hiteles Pro-ellenőrzés egy lépésben */
const proOnly = [requireAuth, requirePro];

/**
 * 🎬 Min. AMATŐR (fizető) gate — a WORKER (felhő-render) + felhő-tár ehhez kötött.
 * A free user a szerver-rendert NEM éri el (402) → eszközön renderel.
 */
function requirePaid(req, res, next) {
  if (INSECURE_DEV) {
    next();
    return;
  }
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  isPaid(uid)
    .then((paid) => {
      if (paid) {
        next();
        return;
      }
      res.status(402).json({ error: 'A felhő-render előfizetést igényel (min. Amatőr); ingyenesben a renderelés az eszközön történik.', pro: true });
    })
    .catch(() => res.status(402).json({ error: 'Az előfizetés nem ellenőrizhető.', pro: true }));
}

/** hitelesítés + min. Amatőr (fizető) — a worker/felhő-render/felhő-tár gate-je */
const paidOnly = [requireAuth, requirePaid];

/**
 * 📊 §2.2: AI-token kvóta-gate (az AI-endpointok ELŐTT). Csak a MI felhő-token-
 * költségünket mérjük: a BYOK és a lokális provider KIMARAD. A hívó uid-ját a
 * kérés idejére az ALS-be tesszük → runStructured onnan könyvel.
 */
async function aiMeter(req, res, next) {
  try {
    if (sanitizeAiConfig(req.body && req.body.aiConfig)) {
      next();
      return;
    }
    if ((await aiProvider()) !== 'anthropic') {
      next();
      return;
    }
    const uid = callerId(req, req.body && req.body.userId);
    const gate = await enforceQuota(uid, await userTier(uid), 'aiTokens', 1);
    if (!gate.ok) {
      res.status(429).json({ error: `Elérted a havi AI-token kvótád. Hátralévő: ${gate.remaining}.` });
      return;
    }
    aiUsageContext.run({ uid }, () => next());
  } catch {
    next(); // best-effort: a metering sosem blokkolja a funkciót hiba esetén
  }
}

/**
 * 🎬 Render-job „puha" hitelesítés (BOLA-fix). A token jöhet Authorization
 * fejlécben VAGY `?t=` query-paraméterben. SZÁNDÉKOSAN nem 401-ezik: az érdemi
 * döntést a handler ownership-ellenőrzése (`canAccessRenderJob`) hozza.
 */
function renderJobAuth(req, _res, next) {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.authorization || '').trim());
  const queryTok = typeof req.query.t === 'string' ? req.query.t.trim() : '';
  const token = (m ? m[1].trim() : '') || queryTok;
  if (!token) {
    req.user = null;
    next();
    return;
  }
  verifyToken(token)
    .then((result) => {
      req.user = result.ok ? result.user : null;
      next();
    })
    .catch(() => {
      req.user = null;
      next();
    });
}

const DEV_BILLING = process.env.ALLOW_DEV_BILLING === '1';
function devBillingGuard(_req, res, next) {
  if (!DEV_BILLING) {
    res.status(403).json({
      error:
        'A manuális aktiválás ki van kapcsolva. A Pro/kredit a RevenueCat webhookon jön ' +
        '(fejlesztéshez: ALLOW_DEV_BILLING=1).',
    });
    return;
  }
  next();
}

module.exports = {
  requirePro,
  proOnly,
  requirePaid,
  paidOnly,
  aiMeter,
  renderJobAuth,
  devBillingGuard,
};
