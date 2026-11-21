// 🗂️ ReMix Storage — pure út-segédek: név/út-normalizálás, a user kulcs-prefixei, ütköző nevek.
const { MARKER, MAX_SEGMENT, MAX_DEPTH, MAX_PATH } = require('./constants');
const { UserFilesError, badPath } = require('./errors');

// ── pure út-segédek ───────────────────────────────────────────────────────────

/** Egy név-szegmens ellenőrzése (fájl- vagy mappanév). */
function cleanSegment(raw) {
  const seg = String(raw ?? '').trim();
  if (!seg || seg === '.' || seg === '..' || seg === MARKER) {
    throw badPath('Érvénytelen név.');
  }
  // eslint-disable-next-line no-control-regex -- szándékosan a vezérlőkaraktereket (U+0000–U+001F, U+007F) tiltja a név-szegmensben
  if (seg.length > MAX_SEGMENT || /[\u0000-\u001f\u007f\\]/.test(seg)) {
    throw badPath('Érvénytelen név.');
  }
  return seg;
}

/**
 * A kliens által küldött, a user gyökeréhez RELATÍV út normalizálása:
 * `'/a//b/'` → `'a/b'`, a gyökér `''`. `..`/vezérlőkarakter/túl mély út → 400.
 */
function normalizePath(raw) {
  const parts = String(raw ?? '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > MAX_DEPTH) {
    throw badPath('Túl mély mappaszerkezet.');
  }
  const out = parts.map(cleanSegment).join('/');
  if (out.length > MAX_PATH) {
    throw badPath('Túl hosszú útvonal.');
  }
  return out;
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function parentOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function baseName(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** A user gyökér-prefixe — a userId-t is szűrjük, hogy ne lehessen kulcsot szökni. */
function userRoot(uid) {
  const id = String(uid ?? '').replace(/[^\w-]/g, '');
  if (!id) {
    throw new UserFilesError(401, 'unauthorized', 'Hiányzó felhasználó.');
  }
  return `files/${id}/`;
}

/** A user Lomtár-prefixe (a fájlok mellett, a user gyökerén KÍVÜL — a böngészőben nem látszik). */
function userTrash(uid) {
  return `trash/${userRoot(uid).slice('files/'.length)}`;
}

/** A user feltöltés-munkamenet prefixe (a böngészőben nem látszik). */
function userUploads(uid) {
  return `uploads/${userRoot(uid).slice('files/'.length)}`;
}

/** Ütköző név feloldása: `video.mp4` → `video (1).mp4` → `video (2).mp4` … */
function nextFreeName(name, taken) {
  if (!taken.has(name)) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new UserFilesError(409, 'conflict', 'Túl sok azonos nevű fájl.');
}

module.exports = {
  cleanSegment,
  normalizePath,
  joinPath,
  parentOf,
  baseName,
  userRoot,
  userTrash,
  userUploads,
  nextFreeName,
};
