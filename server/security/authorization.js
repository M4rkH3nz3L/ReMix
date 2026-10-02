// 🔑 Endpoint policy-réteg (OWASP API5 — Broken Function Level Authorization,
// API9 — Improper Inventory Management).
//
// A worker-végpontok ma ad-hoc módon védettek (van ...proOnly, van requireAuth,
// és sok a teljesen NYITOTT). Ez a modul DEKLARATÍV, egységes policy-szinteket
// ad, és mellékhatásként REGISZTRÁLJA az endpointot egy inventory-ba — így
// gépileg látszik, melyik route milyen szint mögött van (/health/routes), és egy
// teszt elbuktatható, ha egy route policy NÉLKÜL kerül be.
//
// Szintek:  PUBLIC · AUTHENTICATED · PRO · OWNER · EDITOR · MODERATOR · ADMIN · SYSTEM
//
// A `decide()` egy PURE függvény (a hívó képességeiből dönt) → önállóan tesztelhető.
// A middleware-factory-k ezt alkalmazzák, miután a `req`-ből feloldották a
// képességeket (auth a tokenből, Pro a billingből, stb.).

const { requireAuth, INSECURE_DEV } = require('../auth');

const LEVELS = [
  'PUBLIC',
  'AUTHENTICATED',
  'PRO',
  'OWNER',
  'EDITOR',
  'MODERATOR',
  'ADMIN',
  'SYSTEM',
];

// ───────────────────────────────────────────────────────── inventory (API9)

const _inventory = [];

/** Egy route regisztrálása a leltárba (a factory hívja a route-definíciónál). */
function registerRoute(level, meta = {}) {
  _inventory.push({
    level,
    method: meta.method || null,
    path: meta.path || null,
    rateClass: meta.rateClass || null,
  });
}

/** A regisztrált route-ok másolata (/health/routes + teljességi teszt). */
function routeInventory() {
  return _inventory.map((r) => ({ ...r }));
}

/** teszt-segéd. */
function clearInventory() {
  _inventory.length = 0;
}

// ───────────────────────────────────────────────────────── pure döntés

const DENY_401 = { allow: false, status: 401, error: 'Hitelesítés szükséges.' };

/**
 * PURE policy-döntés. `caps` a hívó feloldott képességei:
 *   { authed, pro, owner, editor, role:'admin'|'moderator'|null, system }
 * @returns {{allow:boolean, status?:number, error?:string}}
 */
function decide(level, caps = {}) {
  switch (level) {
    case 'PUBLIC':
      return { allow: true };
    case 'AUTHENTICATED':
      return caps.authed ? { allow: true } : DENY_401;
    case 'PRO':
      if (!caps.authed) return DENY_401;
      return caps.pro
        ? { allow: true }
        : { allow: false, status: 402, error: 'Ehhez a funkcióhoz Pro-előfizetés szükséges.' };
    case 'OWNER':
      if (!caps.authed) return DENY_401;
      return caps.owner
        ? { allow: true }
        : { allow: false, status: 403, error: 'Nincs jogosultság (tulajdonos szükséges).' };
    case 'EDITOR':
      if (!caps.authed) return DENY_401;
      return caps.owner || caps.editor
        ? { allow: true }
        : { allow: false, status: 403, error: 'Nincs jogosultság (szerkesztő szükséges).' };
    case 'MODERATOR':
      if (!caps.authed) return DENY_401;
      return caps.role === 'moderator' || caps.role === 'admin'
        ? { allow: true }
        : { allow: false, status: 403, error: 'Moderátor jogosultság szükséges.' };
    case 'ADMIN':
      if (!caps.authed) return DENY_401;
      return caps.role === 'admin'
        ? { allow: true }
        : { allow: false, status: 403, error: 'Admin jogosultság szükséges.' };
    case 'SYSTEM':
      return caps.system
        ? { allow: true }
        : { allow: false, status: 403, error: 'Rendszer-szintű hívás szükséges.' };
    default:
      return { allow: false, status: 403, error: `Ismeretlen policy-szint: ${level}` };
  }
}

// ───────────────────────────────────────────────────────── middleware-ek

/** szerver-hiteles Pro-kapu (a meglévő requirePro szemantikája, lazy billinggel). */
function proGate(req, res, next) {
  if (INSECURE_DEV) {
    next();
    return;
  }
  const uid = req.user && req.user.id;
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  let isPro;
  try {
    ({ isPro } = require('../billing'));
  } catch {
    res.status(503).json({ error: 'A billing-réteg nem elérhető.' });
    return;
  }
  isPro(uid)
    .then((pro) =>
      pro
        ? next()
        : res.status(402).json({ error: 'Ehhez a funkcióhoz Pro-előfizetés szükséges.', pro: true })
    )
    .catch(() => res.status(402).json({ error: 'Az előfizetés nem ellenőrizhető.', pro: true }));
}

/** PUBLIC — tudatosan nyitott (regisztrálva az inventory-ba). */
function publicRoute(meta) {
  registerRoute('PUBLIC', meta);
  return [(req, _res, next) => next()];
}

/** AUTHENTICATED — verifikált token kell (a requireAuth kezeli az INSECURE_DEV-et). */
function authenticated(meta) {
  registerRoute('AUTHENTICATED', meta);
  return [requireAuth];
}

/** PRO — hitelesítés + szerver-hiteles Pro-ellenőrzés. */
function pro(meta) {
  registerRoute('PRO', meta);
  return [requireAuth, proGate];
}

/** SYSTEM — csak belső/rendszer-hívó (service-secret egyezés). */
function system(meta) {
  registerRoute('SYSTEM', meta);
  const secret = (process.env.WORKER_SYSTEM_SECRET || '').trim();
  return [
    (req, res, next) => {
      if (INSECURE_DEV) {
        next();
        return;
      }
      const got = (req.headers['x-system-secret'] || '').toString();
      if (secret && got && got === secret) {
        next();
        return;
      }
      res.status(403).json({ error: 'Rendszer-szintű hívás szükséges.' });
    },
  ];
}

module.exports = {
  LEVELS,
  decide,
  registerRoute,
  routeInventory,
  clearInventory,
  publicRoute,
  authenticated,
  pro,
  system,
  proGate,
};
