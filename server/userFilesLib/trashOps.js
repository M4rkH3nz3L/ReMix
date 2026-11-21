const { logCaught } = require('../lib/caught');
// 🗂️ ReMix Storage — a Lomtár: lomtárba helyezés, listázás (lejártak takarítása), visszaállítás, ürítés.
const crypto = require('crypto');

const { MARKER, TRASH_META, TRASH_RETENTION_DAYS } = require('./constants');
const { badPath, notFound } = require('./errors');
const { baseName, joinPath, nextFreeName, normalizePath, parentOf, userRoot, userTrash } = require('./paths');

/**
 * @param {object} deps `{ backend, ledger, bucket }` (lásd createUserFiles)
 * @param {object} tree a createTreeOps() segédei (`pairsFor`, `relocate`)
 */
function createTrashOps({ backend, ledger, bucket }, { pairsFor, relocate }) {
  // ── 🗑️ Lomtár ────────────────────────────────────────────────────────────────
  // A törölt elem a `trash/<uid>/<id>/<eredeti út>` alá kerül + egy `.meta.json`
  // (eredeti út, idő, méret). A Lomtár a kvótába számít; 30 nap után a listázás
  // véglegesen kitakarítja. Visszaállításkor ütköző név → `név (1)`.

  async function trash(uid, rawPath) {
    const p = normalizePath(rawPath);
    if (!p) {
      throw badPath('A gyökér nem törölhető.');
    }
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const base = `${userTrash(uid)}${id}`;
    const { pairs, isFolder } = await pairsFor(`${userRoot(uid)}${p}`, `${base}/${p}`);
    const bytes = pairs.reduce((a, pr) => a + pr.size, 0);
    const count = pairs.filter((pr) => !pr.from.endsWith(`/${MARKER}`)).length;
    await backend.putText(
      `${base}/${TRASH_META}`,
      JSON.stringify({ path: p, isFolder, bytes, count, deletedAt: new Date().toISOString() })
    );
    await relocate(uid, pairs);
    return { id, removed: count, bytes };
  }

  async function purgeTrashItem(uid, id) {
    const prefix = `${userTrash(uid)}${id}/`;
    let bytes = 0;
    for (const obj of await backend.listAll(prefix)) {
      await backend.remove(obj.key);
      await ledger.forgetObject(uid, bucket, obj.key);
      if (!obj.key.endsWith(`/${TRASH_META}`)) {
        bytes += obj.size; // a metaadat-fájl nem a user bájtja
      }
    }
    return bytes;
  }

  const cleanId = (id) => {
    const v = String(id ?? '');
    if (!/^[a-z0-9]+-[a-f0-9]{6}$/.test(v)) {
      throw badPath('Érvénytelen Lomtár-azonosító.');
    }
    return v;
  };

  async function listTrash(uid, now = Date.now()) {
    const { folders } = await backend.list(userTrash(uid));
    const items = [];
    for (const id of folders) {
      const raw = await backend.readText(`${userTrash(uid)}${id}/${TRASH_META}`).catch((caught) => { logCaught('userFiles.js:listTrash', caught); return null; });
      let meta = null;
      try {
        meta = raw ? JSON.parse(raw) : null;
      } catch (caught) {
        logCaught('userFiles.js:listTrash', caught);
        meta = null;
      }
      const deletedAt = meta?.deletedAt ? Date.parse(meta.deletedAt) : now;
      const expiresAt = deletedAt + TRASH_RETENTION_DAYS * 86400000;
      if (!meta || expiresAt <= now) {
        await purgeTrashItem(uid, id); // lejárt / sérült bejegyzés → végleges törlés
        continue;
      }
      items.push({
        id,
        path: meta.path,
        name: baseName(meta.path),
        isFolder: Boolean(meta.isFolder),
        bytes: Number(meta.bytes || 0),
        count: Number(meta.count || 0),
        deletedAt: meta.deletedAt,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }
    items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return { items, retentionDays: TRASH_RETENTION_DAYS, bytes: items.reduce((a, i) => a + i.bytes, 0) };
  }

  async function restoreTrash(uid, rawId) {
    const id = cleanId(rawId);
    const base = `${userTrash(uid)}${id}`;
    const raw = await backend.readText(`${base}/${TRASH_META}`);
    if (!raw) {
      throw notFound();
    }
    const meta = JSON.parse(raw);
    const orig = normalizePath(meta.path);
    // ütközés az eredeti helyen → szabad név ugyanabban a szülő-mappában
    const parent = parentOf(orig);
    const siblings = await backend.list(parent ? `${userRoot(uid)}${parent}/` : userRoot(uid));
    const name = nextFreeName(baseName(orig), new Set([...siblings.folders, ...siblings.files.map((f) => f.name)]));
    const target = joinPath(parent, name);
    const { pairs } = await pairsFor(`${base}/${orig}`, `${userRoot(uid)}${target}`);
    await relocate(uid, pairs);
    await backend.remove(`${base}/${TRASH_META}`);
    return { path: target, name };
  }

  async function purgeTrash(uid, ids) {
    let bytes = 0;
    let removed = 0;
    const list = ids === 'all' ? (await backend.list(userTrash(uid))).folders : ids.map(cleanId);
    for (const id of list) {
      bytes += await purgeTrashItem(uid, id);
      removed += 1;
    }
    return { removed, bytes };
  }

  return { trash, listTrash, restoreTrash, purgeTrash };
}

module.exports = { createTrashOps };
