const { logCaught } = require('../lib/caught');
// 🗂️ ReMix Storage — fájl-műveletek a user gyökere alatt: listázás, mappa, feltöltés, törlés,
// áthelyezés, megnyitás (letöltés-stream).
const fs = require('fs');

const { MARKER, MAX_TREE } = require('./constants');
const { UserFilesError, badPath, notFound } = require('./errors');
const { md5OfFile } = require('./md5');
const { baseName, cleanSegment, joinPath, nextFreeName, normalizePath, parentOf, userRoot } = require('./paths');

/**
 * @param {object} deps `{ backend, ledger, bucket }` (lásd createUserFiles)
 * @param {object} tree a createTreeOps() segédei (`isFolder`, `pairsFor`, `relocate`)
 */
function createFileOps({ backend, ledger, bucket }, { isFolder, pairsFor, relocate }) {
  async function list(uid, rawDir) {
    const dir = normalizePath(rawDir);
    const prefix = dir ? `${userRoot(uid)}${dir}/` : userRoot(uid);
    if (dir && !(await isFolder(uid, dir))) {
      throw notFound();
    }
    const { folders, files } = await backend.list(prefix);
    return {
      path: dir,
      folders: folders.sort((a, b) => a.localeCompare(b)).map((name) => ({ name, path: joinPath(dir, name) })),
      files: files
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ name: f.name, path: joinPath(dir, f.name), size: f.size, modified: f.modified })),
    };
  }

  async function mkdir(uid, rawDir, rawName) {
    const dir = normalizePath(rawDir);
    const name = cleanSegment(rawName);
    const p = joinPath(dir, name);
    normalizePath(p); // mélység/hossz-korlát
    const existing = await backend.list(dir ? `${userRoot(uid)}${dir}/` : userRoot(uid));
    if (existing.folders.includes(name) || existing.files.some((f) => f.name === name)) {
      throw new UserFilesError(409, 'exists', 'Már létezik ilyen nevű elem.');
    }
    await backend.putEmpty(`${userRoot(uid)}${p}/${MARKER}`);
    return { name, path: p };
  }

  /**
   * Feltöltés egy mappába. Integritás: ha a kliens `md5`-öt küldött, a beérkezett
   * fájlét ellenőrizzük (eltérés → 422, NEM tároljuk). Idempotencia: ha ugyanazon a
   * néven MÁR ott van egy azonos méretű+MD5-ű fájl (újrapróbált feltöltés), azt adjuk
   * vissza — nem keletkezik `név (1)` duplikátum. Egyéb névütközés → szabad név.
   */
  async function upload(uid, rawDir, { localPath, name: rawName, contentType, md5 }) {
    const dir = normalizePath(rawDir);
    const name = cleanSegment(rawName);
    const bytes = fs.statSync(localPath).size;
    const sum = await md5OfFile(localPath);
    if (md5 && String(md5).toLowerCase() !== sum) {
      throw new UserFilesError(422, 'checksum_mismatch', 'A fájl sérülten érkezett meg — próbáld újra.');
    }
    const prefix = dir ? `${userRoot(uid)}${dir}/` : userRoot(uid);
    const existing = await backend.list(prefix);
    const same = existing.files.find((f) => f.name === name && f.size === bytes);
    if (same) {
      const head = await backend.head(`${prefix}${name}`);
      if (head && head.etag === sum) {
        return { name, path: joinPath(dir, name), size: bytes, md5: sum, deduplicated: true };
      }
    }
    const taken = new Set([...existing.files.map((f) => f.name), ...existing.folders]);
    const finalName = nextFreeName(name, taken);
    const p = joinPath(dir, finalName);
    normalizePath(p);
    const key = `${userRoot(uid)}${p}`;

    const pre = await ledger.wouldExceed(uid, bytes);
    if (pre.exceeded) {
      throw Object.assign(new UserFilesError(507, 'quota_exceeded', 'Betelt a tárhelyed.'), { usage: pre.usage });
    }
    await backend.put(key, localPath, contentType);
    // ✅ ellenőrzés a célon: méret (+ MD5, ha a backend adja) — csak ezután „kész"
    const head = await backend.head(key);
    if (!head || head.size !== bytes || (head.etag && /^[0-9a-f]{32}$/.test(head.etag) && head.etag !== sum)) {
      await backend.remove(key).catch((caught) => { logCaught('userFiles.js:upload', caught); });
      throw new UserFilesError(502, 'verify_failed', 'A feltöltött példány ellenőrzése nem sikerült.');
    }
    try {
      await ledger.recordObject(uid, { projectId: null, bucket, key, bytes, source: 'server' });
    } catch (err) {
      // a kvóta-főkönyv elutasította (verseny) → a tárolt objektumot is visszavonjuk
      await backend.remove(key).catch((caught) => { logCaught('userFiles.js:upload', caught); });
      throw err;
    }
    return { name: finalName, path: p, size: bytes, md5: sum, deduplicated: false };
  }

  /** Egy fájl vagy egy egész mappa (rekurzívan) törlése + a főkönyv frissítése. */
  async function remove(uid, rawPath) {
    const p = normalizePath(rawPath);
    if (!p) {
      throw badPath('A gyökér nem törölhető.');
    }
    const key = `${userRoot(uid)}${p}`;
    const file = await backend.head(key);
    if (file) {
      await backend.remove(key);
      await ledger.forgetObject(uid, bucket, key);
      return { removed: 1, bytes: file.size };
    }
    const tree = await backend.listAll(`${key}/`);
    if (!tree.length) {
      throw notFound();
    }
    if (tree.length > MAX_TREE) {
      throw new UserFilesError(413, 'too_many', 'Túl sok elem egyszerre — ürítsd részenként.');
    }
    let bytes = 0;
    for (const obj of tree) {
      await backend.remove(obj.key);
      await ledger.forgetObject(uid, bucket, obj.key);
      bytes += obj.size;
    }
    return { removed: tree.filter((o) => !o.key.endsWith(`/${MARKER}`)).length, bytes };
  }

  /** Átnevezés / áthelyezés (fájl vagy mappa): másolás → ellenőrzés → régi törlése. */
  async function move(uid, rawFrom, rawTo) {
    const from = normalizePath(rawFrom);
    const to = normalizePath(rawTo);
    if (!from || !to) {
      throw badPath();
    }
    if (from === to) {
      return { path: to };
    }
    if (to.startsWith(`${from}/`)) {
      throw badPath('Mappa nem helyezhető önmagába.');
    }
    const root = userRoot(uid);
    if (parentOf(to) && !(await isFolder(uid, parentOf(to)))) {
      throw notFound();
    }
    const destTaken = (await backend.head(`${root}${to}`)) || (await backend.listAll(`${root}${to}/`)).length > 0;
    if (destTaken) {
      throw new UserFilesError(409, 'exists', 'Már létezik ilyen nevű elem.');
    }
    const { pairs } = await pairsFor(`${root}${from}`, `${root}${to}`);
    await relocate(uid, pairs);
    return { path: to, name: baseName(to) };
  }

  async function open(uid, rawPath) {
    const p = normalizePath(rawPath);
    if (!p) {
      throw badPath();
    }
    const s = await backend.stream(`${userRoot(uid)}${p}`);
    if (!s) {
      throw notFound();
    }
    return { ...s, name: baseName(p) };
  }

  return { list, mkdir, upload, remove, move, open };
}

module.exports = { createFileOps };
