// 🪵 Strukturált logger (05-observability §05.1). Vékony, függőség-mentes JSON-logger:
// szint + timestamp + korrelációs kontextus (request-id / job-id / user / route). Prod-ban
// JSON-sor (aggregátor-barát, az auditLog.js stílusa); dev-ben olvasható fejlécelt sor.
// A szint `LOG_LEVEL` env-vel állítható. SOHA nem dob (best-effort).

const crypto = require('crypto');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** A konfigurált log-küszöb (LOG_LEVEL, alap 'info'). */
function levelThreshold(env = process.env) {
  const l = String(env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[l] ?? LEVELS.info;
}

/** Átmegy-e ez a szint a küszöbön? (error mindig; debug csak LOG_LEVEL=debug-nál) */
function shouldLog(level, env = process.env) {
  return (LEVELS[level] ?? 99) <= levelThreshold(env);
}

/**
 * PURE: egy log-bejegyzés szöveges alakja. Prod → JSON-sor; `pretty` → olvasható.
 * A `ts` injektálható (teszt-determinizmus).
 */
function formatEntry(level, msg, ctx = {}, { ts, pretty = false } = {}) {
  const stamp = ts || new Date().toISOString();
  if (pretty) {
    const rest = ctx && Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : '';
    return `[${stamp}] ${String(level).toUpperCase()} ${msg}${rest}`;
  }
  return JSON.stringify({ level, ts: stamp, msg, ...ctx });
}

/** Rövid korrelációs azonosító (request-id / trace). */
function makeRequestId() {
  try {
    return crypto.randomBytes(6).toString('hex');
  } catch {
    return String(Date.now());
  }
}

const PRETTY = process.env.NODE_ENV !== 'production';

function emit(level, msg, ctx) {
  try {
    if (!shouldLog(level)) {
      return;
    }
    const line = formatEntry(level, msg, ctx, { pretty: PRETTY });
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  } catch {
    /* a logging SOHA ne buktasson el kérést/rendert */
  }
}

const log = {
  error: (msg, ctx) => emit('error', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx),
  debug: (msg, ctx) => emit('debug', msg, ctx),
  /** gyermek-logger rögzített kontextussal (pl. { reqId } vagy { jobId }) — korreláció. */
  child: (base = {}) => ({
    error: (msg, ctx) => emit('error', msg, { ...base, ...ctx }),
    warn: (msg, ctx) => emit('warn', msg, { ...base, ...ctx }),
    info: (msg, ctx) => emit('info', msg, { ...base, ...ctx }),
    debug: (msg, ctx) => emit('debug', msg, { ...base, ...ctx }),
  }),
};

module.exports = { log, formatEntry, shouldLog, levelThreshold, makeRequestId, LEVELS };
