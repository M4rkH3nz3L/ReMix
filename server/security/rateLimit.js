// 🧱 Rate limiting (OWASP API4 — Unrestricted Resource Consumption).
//
// A worker publikus compute-API: FFmpeg/Chromium/ONNX/AI végpontok hívhatók.
// Limit nélkül ez közvetlen DoS- és költség-attack felület. Ez a modul
// endpoint-OSZTÁLYONKÉNT korlátoz, a legszűkebb elérhető azonosítón:
//   verifikált user  >  eszköz-id  >  IP
// — így a névtelen (token nélküli, de IP-vel elérhető) hívás is korlátozható,
// ANÉLKÜL hogy a klienst tokenre kényszerítenénk (nem töri a jelenlegi appot).
//
// Tár: ha van REDIS_URL → közös (több worker-instance között is helyes);
// különben process-lokális in-memory (dev/egy-instance). Új npm-dep NÉLKÜL
// (a meglévő ioredis-t használja a queue.js connectionjén át).
//
// Env:
//   RL_DISABLED=1            → teljes kikapcsolás (vészkapcsoló)
//   RL_<OSZTÁLY>_MAX=<n>     → az osztály kérés-plafonja az ablakban
//   RL_<OSZTÁLY>_WINDOW=<ms> → az ablak hossza ms-ben
//   (pl. RL_AI_MAX=30 RL_AI_WINDOW=60000)

const INSECURE_DEV = process.env.ALLOW_INSECURE_DEV === '1';
const DISABLED = process.env.RL_DISABLED === '1';

// Alap-limitek osztályonként (ablak ms + max kérés/ablak). Szándékosan BŐKEZŰ:
// a cél a visszaélés/DoS kivédése, nem a legitim használat akadályozása.
const DEFAULTS = {
  ai: { windowMs: 60_000, max: 30 }, // AI: drága, user+subscription
  render: { windowMs: 60_000, max: 20 }, // render dispatch
  upload: { windowMs: 60_000, max: 60 }, // média-feltöltés
  analysis: { windowMs: 60_000, max: 60 }, // shotscore/vision/depth/color/waveform
  tts: { windowMs: 60_000, max: 30 },
  messaging: { windowMs: 60_000, max: 60 }, // notify/invite
  billing: { windowMs: 60_000, max: 30 },
  public: { windowMs: 60_000, max: 240 }, // library/music/health — laza, de van
  default: { windowMs: 60_000, max: 120 },
};

/** Egy osztály konfigja az env-felülírásokkal. */
function classConfig(className) {
  const base = DEFAULTS[className] || DEFAULTS.default;
  const up = className.toUpperCase();
  const max = parseInt(process.env[`RL_${up}_MAX`] || '', 10);
  const win = parseInt(process.env[`RL_${up}_WINDOW`] || '', 10);
  return {
    windowMs: Number.isFinite(win) && win > 0 ? win : base.windowMs,
    max: Number.isFinite(max) && max > 0 ? max : base.max,
  };
}

/**
 * A kérés azonosító-kulcsa: a legerősebb ismert azonosító. A verifikált user
 * (requireAuth után req.user.id) a legjobb; utána egy kliens-eszköz fejléc;
 * végül az IP (névtelen hívó). `prefix` elkülöníti a tér-névteret (osztály).
 */
function keyFor(req, className) {
  const uid = req.user && req.user.id;
  if (uid) {
    return `rl:${className}:u:${uid}`;
  }
  const device = req.headers['x-device-id'];
  if (device && typeof device === 'string') {
    return `rl:${className}:d:${device.slice(0, 64)}`;
  }
  // IP: az első X-Forwarded-For (reverse proxy mögött), különben a socket
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.ip || req.socket?.remoteAddress || 'unknown';
  return `rl:${className}:ip:${ip}`;
}

// ───────────────────────────────────────────────────────── tárak

/** Process-lokális fixed-window számláló (dev / egy-instance / teszt). */
class MemoryStore {
  constructor() {
    this.map = new Map(); // key → { count, resetAt }
  }

  /** @returns {{count:number, resetAt:number}} az aktuális ablak állapota a hit után */
  async hit(key, windowMs) {
    const now = Date.now();
    const cur = this.map.get(key);
    if (!cur || cur.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      this.map.set(key, next);
      return next;
    }
    cur.count += 1;
    return cur;
  }

  /** teszt-segéd: takarítás */
  reset() {
    this.map.clear();
  }
}

/** Közös Redis-számláló (több worker-instance között is helyes). */
class RedisStore {
  constructor(redis) {
    this.redis = redis;
  }

  async hit(key, windowMs) {
    const bucket = Math.floor(Date.now() / windowMs);
    const k = `${key}:${bucket}`;
    const count = await this.redis.incr(k);
    if (count === 1) {
      await this.redis.pexpire(k, windowMs);
    }
    return { count, resetAt: (bucket + 1) * windowMs };
  }
}

let sharedStore = null;
/** A használandó tár: Redis ha elérhető, különben in-memory. */
function store() {
  if (sharedStore) {
    return sharedStore;
  }
  try {
    const { queueEnabled, connection } = require('../queue');
    if (queueEnabled()) {
      sharedStore = new RedisStore(connection());
      return sharedStore;
    }
  } catch {
    // a queue modul hiánya/hibája → in-memory fallback
  }
  sharedStore = new MemoryStore();
  return sharedStore;
}

/**
 * Pure döntés-függvény (tesztelhető): egy hit után megengedett-e a kérés.
 * @returns {Promise<{allowed:boolean, remaining:number, retryAfterSec:number, limit:number}>}
 */
async function evaluate(st, key, { max, windowMs }) {
  const { count, resetAt } = await st.hit(key, windowMs);
  const remaining = Math.max(0, max - count);
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return { allowed: count <= max, remaining, retryAfterSec, limit: max };
}

/**
 * Express-middleware egy endpoint-osztályhoz. A `policy`-réteg (01) UTÁN fut,
 * így a `req.user` (ha van) már beállított → user-kulcsú limit a Pro-knak.
 */
function rateLimit(className) {
  if (DISABLED || INSECURE_DEV) {
    // dev / vészkapcsoló: ne akadályozza a fejlesztést
    return (_req, _res, next) => next();
  }
  const cfg = classConfig(className);
  return (req, res, next) => {
    const key = keyFor(req, className);
    evaluate(store(), key, cfg)
      .then((r) => {
        res.setHeader('X-RateLimit-Limit', String(r.limit));
        res.setHeader('X-RateLimit-Remaining', String(r.remaining));
        if (r.allowed) {
          next();
          return;
        }
        res.setHeader('Retry-After', String(r.retryAfterSec));
        res.status(429).json({
          error: `Túl sok kérés. Próbáld újra ${r.retryAfterSec} mp múlva.`,
        });
      })
      .catch(() => next()); // a limiter hibája SOHA ne dobja el a legitim kérést
  };
}

module.exports = {
  rateLimit,
  // tesztelhető belsők:
  keyFor,
  classConfig,
  evaluate,
  MemoryStore,
  DEFAULTS,
};
