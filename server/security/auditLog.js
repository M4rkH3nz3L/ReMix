// 📝 Audit- és security-event napló (devs/tasks/remix/14).
//
// Strukturált, append-only napló a biztonság-releváns eseményekhez: ki / mit /
// mikor / milyen eredménnyel. A kimenet mindig egy strukturált JSON-sor a
// stdout-ra (log-aggregátor barát); ha az AUDIT_LOG_FILE env be van állítva,
// fájlba is hozzáfűzünk (best-effort). A felhasználók ebből látják utólag a
// rate-limit-találatokat, a render-BOLA elutasításokat, az SSRF-blokkokat stb.
//
// A formázás PURE (esemény + időbélyeg → JSON-sor) → determinisztikusan
// tesztelhető; a sink (console/fájl) külön.
const fs = require('fs');

const AUDIT_FILE = (process.env.AUDIT_LOG_FILE || '').trim();

/**
 * Egy napló-bejegyzés kanonikus JSON-sora. @param nowIso ISO-időbélyeg (kívülről
 * adva → tesztelhető). @returns {string}
 */
function formatAuditEntry(event, nowIso) {
  const entry = {
    ts: nowIso,
    kind: event && event.kind === 'security' ? 'security' : 'audit',
    type: (event && event.type) || 'unknown',
    actor: event && event.actor != null ? event.actor : null,
    target: event && event.target != null ? event.target : null,
    result: event && event.result != null ? event.result : null,
  };
  if (event && event.meta && typeof event.meta === 'object') {
    entry.meta = event.meta;
  }
  return JSON.stringify(entry);
}

/** a sor kiírása: stdout + opcionális fájl (best-effort, sosem dob) */
function write(line) {
  try {
    console.log(`[audit] ${line}`);
  } catch {
    /* ignore */
  }
  if (AUDIT_FILE) {
    try {
      fs.appendFileSync(AUDIT_FILE, line + '\n');
    } catch {
      /* best-effort */
    }
  }
}

/** Általános audit-bejegyzés. A naplózás SOHA ne buktasson el egy kérést. */
function audit(event) {
  try {
    write(formatAuditEntry(event, new Date().toISOString()));
  } catch {
    /* ignore */
  }
}

/**
 * Security-esemény (rate-limit-találat, BOLA-elutasítás, SSRF-blokk, auth-hiba).
 * @param type pl. 'render.denied' | 'ratelimit.block' | 'ssrf.block'
 */
function securityEvent(type, opts = {}) {
  audit({
    kind: 'security',
    type,
    actor: opts.actor,
    target: opts.target,
    result: opts.result || 'denied',
    meta: opts.meta,
  });
}

module.exports = { audit, securityEvent, formatAuditEntry };
