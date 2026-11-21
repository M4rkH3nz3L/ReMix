// 🗂️ ReMix Storage — a mappa-fa segédei (közös a fájl- és a Lomtár-műveleteknek):
// mappa-e egy út, forrás→cél kulcspárok, adatvesztés nélküli áthelyezés.
const { MARKER, MAX_TREE } = require('./constants');
const { UserFilesError, notFound } = require('./errors');
const { userRoot } = require('./paths');

/** @param {object} deps `{ backend, ledger, bucket }` (lásd createUserFiles) */
function createTreeOps({ backend, ledger, bucket }) {
  async function isFolder(uid, p) {
    if (!p) {
      return true;
    }
    const prefix = `${userRoot(uid)}${p}/`;
    const items = await backend.list(prefix);
    if (items.folders.length || items.files.length) {
      return true;
    }
    return Boolean(await backend.head(`${prefix}${MARKER}`));
  }

  /**
   * Egy fájl (vagy mappa-fa) forrás→cél kulcspárjai. `fromKey` = a teljes kulcs
   * (fájl) vagy mappa-prefix (perjel nélkül); `toBase` ugyanígy.
   */
  async function pairsFor(fromKey, toBase) {
    const file = await backend.head(fromKey);
    if (file) {
      return { pairs: [{ from: fromKey, to: toBase, size: file.size }], isFolder: false };
    }
    const tree = await backend.listAll(`${fromKey}/`);
    if (!tree.length) {
      throw notFound();
    }
    if (tree.length > MAX_TREE) {
      throw new UserFilesError(413, 'too_many', 'Túl sok elem egyszerre — végezd részenként.');
    }
    return {
      pairs: tree.map((obj) => ({ from: obj.key, to: `${toBase}/${obj.key.slice(fromKey.length + 1)}`, size: obj.size })),
      isFolder: true,
    };
  }

  /**
   * Áthelyezés ADATVESZTÉS NÉLKÜL: MINDENT átmásolunk és ellenőrzünk, a forrás csak
   * ezután törlődik; a kvóta-főkönyv követi a kulcsot (a bájt nem változik).
   */
  async function relocate(uid, pairs) {
    for (const pr of pairs) {
      await backend.copy(pr.from, pr.to);
      const head = await backend.head(pr.to);
      if (!head || head.size !== pr.size) {
        throw new UserFilesError(502, 'verify_failed', 'Az áthelyezett példány ellenőrzése nem sikerült.');
      }
    }
    for (const pr of pairs) {
      await ledger.moveObject(uid, bucket, pr.from, pr.to);
      await backend.remove(pr.from);
    }
  }

  return { isFolder, pairsFor, relocate };
}

module.exports = { createTreeOps };
