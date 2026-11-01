const path = require('path');

const { redactSecrets } = require('../security/redact');
const { BugStore } = require('./bugStore');
const { log } = require('./log');

/**
 * 📋 A worker elkapott hibái: a naplóba és a `server/bugs/` mappába is kerülnek, ugyanazzal az
 * ujjlenyomattal, mint az app jelentései. Egy hiba ugyanonnan percenként egyszer íródik, a köztes
 * ismétlések száma megmarad. Sosem dob.
 */
const THROTTLE_MS = 60_000;
const seen = new Map();
let store = null;

function bugStore() {
  store ??= new BugStore({ dir: process.env.BUGS_DIR || path.join(__dirname, '..', 'bugs') });
  return store;
}

function logCaught(where, error) {
  try {
    const name = (error && error.name) || 'Error';
    const message = redactSecrets(String((error && error.message) || error));
    log.warn('caught', { where, error: message });
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const key = `${where}|${message.slice(0, 160)}`;
    const now = Date.now();
    const prev = seen.get(key) || { at: 0, repeat: 0 };
    if (now - prev.at < THROTTLE_MS) {
      seen.set(key, { at: prev.at, repeat: prev.repeat + 1 });
      return;
    }
    seen.set(key, { at: now, repeat: 0 });
    const report = {
      qid: `srv${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      kind: 'server',
      repeat: prev.repeat + 1,
      name,
      message,
      stack: redactSecrets(String((error && error.stack) || '')),
      platform: 'server',
      breadcrumbs: [],
      extra: { where },
    };
    bugStore().ingest(report, null).catch((e) => log.warn('caught-store', { error: e && e.message }));
  } catch {
    // a naplózó nem okozhat újabb hibát
  }
}

module.exports = { logCaught };
