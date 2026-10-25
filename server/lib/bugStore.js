const fsp = require('fs/promises');
const path = require('path');

const { bugFileName, fingerprint, isDuplicateOccurrence, mergeBug } = require('./bugReport');

/**
 * 🐞 Hiba-tár a `server/bugs/` mappához — KÍMÉLETES a workerre (ami a renderelést
 * és az AI-t is kiszolgálja):
 *  - kizárólag ASZINKRON fájlművelet (sosem blokkolja az eseményhurkot),
 *  - az ujjlenyomat → fájlnév index a MEMÓRIÁBAN (egyszer épül fel lustán, utána
 *    karbantartva) — nincs mappa-listázás jelentésenként,
 *  - ujjlenyomatonként soros feldolgozás (az egyidejű azonos jelentések nem
 *    veszítenek számlálót), atomi írás (tmp → rename),
 *  - fájlszám-plafon: fölötte új hiba nem, csak a meglévők számlálója nő.
 * A fejlesztő által a fájlba írt `status`/`notes` sosem íródik felül (minden
 * beolvasztás a lemezen lévő friss állapotból indul).
 */
class BugStore {
  constructor({ dir, maxFiles = 2000 }) {
    this.dir = dir;
    this.maxFiles = maxFiles;
    /** @type {Map<string, string> | null} ujjlenyomat → fájlnév */
    this.index = null;
    this.indexing = null;
    /** @type {Map<string, Promise<unknown>>} */
    this.locks = new Map();
  }

  async ensureIndex() {
    if (this.index) {
      return this.index;
    }
    if (!this.indexing) {
      this.indexing = (async () => {
        await fsp.mkdir(this.dir, { recursive: true });
        const map = new Map();
        for (const f of await fsp.readdir(this.dir)) {
          const m = /^([0-9a-f]{12})_.*\.json$/.exec(f);
          if (m) {
            map.set(m[1], f);
          }
        }
        this.index = map;
        return map;
      })().finally(() => {
        this.indexing = null;
      });
    }
    return this.indexing;
  }

  withLock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.locks.set(key, tail);
    tail.then(() => {
      if (this.locks.get(key) === tail) {
        this.locks.delete(key);
      }
    });
    return next;
  }

  async readDoc(file) {
    try {
      return JSON.parse(await fsp.readFile(path.join(this.dir, file), 'utf8'));
    } catch {
      return null; // hiányzó/sérült fájl → újrakezdjük
    }
  }

  async writeDoc(file, doc) {
    const target = path.join(this.dir, file);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2));
    await fsp.rename(tmp, target);
  }

  /**
   * Egy (már sanitizált) jelentés beolvasztása. Eredmény:
   * `{ id, count, status, file }` | `{ id, duplicate: true, count }` | `{ id, dropped: true }`.
   */
  async ingest(report, userId, nowIso = new Date().toISOString()) {
    const index = await this.ensureIndex();
    const fp = fingerprint(report);
    return this.withLock(fp, async () => {
      const existingFile = index.get(fp);
      const existing = existingFile ? await this.readDoc(existingFile) : null;
      if (!existingFile && index.size >= this.maxFiles) {
        return { id: fp, dropped: true };
      }
      if (isDuplicateOccurrence(existing, report)) {
        return { id: fp, duplicate: true, count: existing.count, status: existing.status };
      }
      const merged = mergeBug(existing, report, fp, nowIso, userId);
      const file = existingFile || bugFileName(fp, report);
      await this.writeDoc(file, merged);
      index.set(fp, file);
      return { id: fp, count: merged.count, status: merged.status, file, isNew: !existing };
    });
  }
}

module.exports = { BugStore };
