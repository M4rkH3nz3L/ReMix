const crypto = require('crypto');

/**
 * 🐞 Hibajelentés-mag (tiszta, függőség nélkül → tesztelhető).
 *
 * Az app a futásidejű hibáit a workerre küldi; itt dől el, hogy KÉT jelentés
 * UGYANAZ a hiba-e (ujjlenyomat), és hogyan olvad össze az egy hibához tartozó
 * fájl (`server/bugs/<ujjlenyomat>_<slug>.json`). Hibánként EGY fájl: az ismétlődő
 * előfordulás nem szemetel új fájlt, hanem számlálót, utolsó előfordulásokat és
 * az érintett platform/verzió/eszköz-statisztikát frissíti. A `fixed`-re jelölt
 * hiba újbóli előfordulása → `regressed` (a javítás nem tartott).
 */

const KINDS = new Set(['js-fatal', 'js-error', 'unhandled-rejection', 'boundary', 'handled', 'native']);
const PLATFORMS = new Set(['android', 'ios', 'web']);
const MAX_OCCURRENCES = 10;
const MAX_MAP_KEYS = 20;
const MAX_USERS = 20;

function str(v, max) {
  if (v == null) {
    return '';
  }
  const s = typeof v === 'string' ? v : String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * A bejövő (nem megbízható) jelentés normalizálása: típusok, hossz-plafonok,
 * enumok. `null`, ha nincs értékelhető tartalom (se üzenet, se stack).
 */
function sanitizeReport(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const message = str(body.message, 2000).trim();
  const stack = str(body.stack, 8000).trim();
  if (!message && !stack) {
    return null;
  }
  const breadcrumbs = Array.isArray(body.breadcrumbs)
    ? body.breadcrumbs.slice(-30).map((b) => str(b, 200))
    : [];
  const extra = {};
  if (body.extra && typeof body.extra === 'object' && !Array.isArray(body.extra)) {
    for (const [k, v] of Object.entries(body.extra).slice(0, 20)) {
      extra[str(k, 60)] = typeof v === 'string' ? str(v, 500) : str(JSON.stringify(v), 500);
    }
  }
  const qid = typeof body.qid === 'string' && /^[0-9a-z]{4,40}$/.test(body.qid) ? body.qid : '';
  const repeatRaw = Number(body.repeat);
  const repeat = Number.isFinite(repeatRaw) ? Math.max(1, Math.min(1000, Math.floor(repeatRaw))) : 1;
  return {
    qid,
    repeat,
    kind: KINDS.has(body.kind) ? body.kind : 'js-error',
    name: str(body.name, 120).trim() || 'Error',
    message,
    stack,
    componentStack: str(body.componentStack, 4000).trim(),
    platform: PLATFORMS.has(body.platform) ? body.platform : 'unknown',
    osVersion: str(body.osVersion, 40),
    appVersion: str(body.appVersion, 40),
    model: str(body.model, 80),
    route: str(body.route, 200),
    projectId: str(body.projectId, 80),
    breadcrumbs,
    extra,
  };
}

/**
 * Üzenet-normalizálás az ujjlenyomathoz: a változó részek (azonosítók, számok,
 * utak, URL-ek) helyőrzőre cserélve — „Nincs ilyen klip (clip_a8f3)" és
 * „Nincs ilyen klip (clip_77b1)" UGYANAZ a hiba.
 */
function normalizeMessage(message) {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/file:\/\/\S+/g, '<path>')
    .replace(/\/[\w.-]+(\/[\w.-]+)+/g, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[a-z]+_[0-9a-z]{4,}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * A stack felső kereteinek stabil kulcsa: a függvénynév + a fájl alapneve,
 * sor/oszlop és bundle-query NÉLKÜL (build-enként változnak — ugyanaz a hiba
 * két buildben is ugyanaz maradjon).
 */
function stackSignature(stack, frames = 5) {
  const out = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ') && !/@/.test(line)) {
      continue;
    }
    const fn = (line.match(/^at\s+([^\s(]+)/) || line.match(/^([^@\s]+)@/) || [])[1] || '?';
    const fileMatch = line.match(/([\w.-]+\.(?:bundle|js|jsx|ts|tsx|hbc))/);
    const file = fileMatch ? fileMatch[1] : '';
    out.push(`${fn}@${file}`);
    if (out.length >= frames) {
      break;
    }
  }
  return out.join('|');
}

/** 12 hex-jegyű ujjlenyomat (fájlnév-biztos: csak [0-9a-f]). */
function fingerprint(report) {
  const basis = [report.kind === 'js-fatal' ? 'js-error' : report.kind, report.name, normalizeMessage(report.message), stackSignature(report.stack)].join('#');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

/** olvasható, fájlnév-biztos rövid név az üzenetből (ékezetek nélkül) */
function slugify(text) {
  const s = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'hiba';
}

function bugFileName(fp, report) {
  return `${fp}_${slugify(`${report.name} ${report.message}`)}.json`;
}

function bump(map, key) {
  const k = key || 'unknown';
  const next = { ...(map || {}) };
  if (k in next || Object.keys(next).length < MAX_MAP_KEYS) {
    next[k] = (next[k] || 0) + 1;
  }
  return next;
}

/**
 * Egy előfordulás beolvasztása a hiba-fájlba (`existing` = null → új hiba).
 * Determinista: a `nowIso` kívülről jön.
 */
/**
 * Újraküldött (már beolvasztott) jelentés-e: a kliens legalább-egyszer kézbesít,
 * ugyanazzal a `qid`-del — a már rögzített előfordulást NEM számoljuk újra.
 */
function isDuplicateOccurrence(existing, report) {
  if (!existing || !report.qid) {
    return false;
  }
  return (existing.occurrences || []).some((o) => o.qid === report.qid);
}

function mergeBug(existing, report, fp, nowIso, userId) {
  const occurrence = {
    at: nowIso,
    qid: report.qid || undefined,
    repeat: report.repeat > 1 ? report.repeat : undefined,
    kind: report.kind,
    platform: report.platform,
    osVersion: report.osVersion,
    appVersion: report.appVersion,
    model: report.model,
    route: report.route,
    projectId: report.projectId,
    userId: userId || null,
    breadcrumbs: report.breadcrumbs,
    extra: report.extra,
  };
  const base = existing || {
    id: fp,
    title: str(`${report.name}: ${report.message}`, 160),
    status: 'open',
    firstSeen: nowIso,
    count: 0,
    platforms: {},
    appVersions: {},
    devices: {},
    affectedUsers: [],
    occurrences: [],
    notes: '',
  };
  const users = new Set(base.affectedUsers || []);
  if (userId && users.size < MAX_USERS) {
    users.add(userId);
  }
  return {
    ...base,
    // a fixed-re jelölt hiba visszatért → a javítás nem tartott
    status: base.status === 'fixed' ? 'regressed' : base.status || 'open',
    lastSeen: nowIso,
    // a kliens-throttle által elnyelt ismétlések is számítanak (repeat ≥ 1)
    count: (base.count || 0) + (report.repeat || 1),
    name: report.name,
    message: report.message,
    stack: report.stack || base.stack || '',
    componentStack: report.componentStack || base.componentStack || '',
    platforms: bump(base.platforms, report.platform),
    appVersions: bump(base.appVersions, report.appVersion),
    devices: bump(base.devices, report.model),
    affectedUsers: [...users],
    occurrences: [...(base.occurrences || []), occurrence].slice(-MAX_OCCURRENCES),
  };
}

module.exports = {
  sanitizeReport,
  normalizeMessage,
  stackSignature,
  fingerprint,
  slugify,
  bugFileName,
  isDuplicateOccurrence,
  mergeBug,
  MAX_OCCURRENCES,
};
