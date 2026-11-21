// 🔌 Külső tárhely — a per-user gateway: forrás-lista, aktív cél, listázás / stream / feltöltés
// a forrás típusa szerinti connectorra osztva (mindig a user SAJÁT forrásai közül).
const { adminClient } = require('../notify');
const { davListMedia, davStream, davUpload, s3ListMedia, s3Stream, s3Upload } = require('../storage');
const { loadUserSources, findUserSource } = require('./sourcesDb');
const { fileToken } = require('./signing');
const { gdriveListMedia, gdriveStream, gdriveUpload } = require('./gdrive');
const { dropboxListMedia, dropboxStream, dropboxUpload } = require('./dropbox');
const { onedriveListMedia, onedriveStream, onedriveUpload } = require('./onedrive');

/**
 * Helyi fájl feltöltése a user SAJÁT (kijelölt) forrására. Visszaadja a
 * forrás-relatív utat + a hozzá tartozó capability-tokent, amiből a hívó a
 * proxyzott, VISSZAOLVASHATÓ URL-t építi (`/storage/:id/file?path=…&it=…`).
 */
async function uploadToSource(uid, sourceId, localPath, filename, contentType) {
  const source = await findUserSource(uid, sourceId);
  if (!source) {
    throw new Error('Ismeretlen forrás.');
  }
  let path;
  switch (source.type) {
    case 'gdrive':
      path = await gdriveUpload(source, localPath, filename, contentType);
      break;
    case 'dropbox':
      path = await dropboxUpload(source, localPath, filename);
      break;
    case 'onedrive':
      path = await onedriveUpload(source, localPath, filename);
      break;
    case 'webdav':
      path = `ReMix/${filename}`;
      await davUpload({ ...source.config, id: source.id }, path, localPath, contentType);
      break;
    case 's3':
      path = `${String(source.config.prefix || '').replace(/^\/+/, '')}${filename}`;
      await s3Upload({ ...source.config, id: source.id }, path, localPath, contentType);
      break;
    default:
      throw new Error(`Ismeretlen forrás-típus: ${source.type}`);
  }
  return { path, token: fileToken(uid, sourceId, path) };
}

// ───────────────────────────────────────────────────────── Gateway (per-user)
/** A Tár panel forrás-listája a userhez (hitelesítés nélküli metaadat). */
async function describeUserSources(uid) {
  const rows = await loadUserSources(uid);
  return rows.map((s) => ({ id: s.id, label: s.label, type: s.type }));
}

/** A user bekötött forrásai a profil-kijelzéshez (státusszal + alapértelmezettel). */
async function listConnected(uid) {
  const rows = await loadUserSources(uid);
  return rows.map((s) => ({
    id: s.id,
    label: s.label,
    type: s.type,
    status: s.status,
    isDefault: !!s.is_default,
  }));
}

/** Az aktív tárhely-cél forrás-id-je, vagy null (= ReMix-tárhely az alap). */
async function getDefaultTarget(uid) {
  const rows = await loadUserSources(uid);
  return rows.find((s) => s.is_default)?.id ?? null;
}

/** Az aktív cél beállítása: null → ReMix, különben a megadott (saját) forrás. */
async function setDefaultTarget(uid, sourceId) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('service_role nincs beállítva a workeren.');
  }
  await sb.from('user_storage_providers').update({ is_default: false }).eq('user_id', uid);
  if (sourceId) {
    const { error } = await sb
      .from('user_storage_providers')
      .update({ is_default: true })
      .eq('user_id', uid)
      .eq('id', sourceId);
    if (error) {
      throw new Error(error.message);
    }
  }
}

async function listUserSource(uid, sourceId) {
  const source = await findUserSource(uid, sourceId);
  if (!source) {
    return null;
  }
  let entries;
  switch (source.type) {
    case 'gdrive':
      entries = await gdriveListMedia(source);
      break;
    case 'dropbox':
      entries = await dropboxListMedia(source);
      break;
    case 'onedrive':
      entries = await onedriveListMedia(source);
      break;
    case 'webdav':
      entries = await davListMedia({ ...source.config, id: source.id });
      break;
    case 's3':
      entries = await s3ListMedia({ ...source.config, id: source.id });
      break;
    default:
      throw new Error(`Ismeretlen forrás-típus: ${source.type}`);
  }
  // minden entry-URL kap egy capability-tokent → a stream bearer nélkül is megy
  // (natív letöltés + web-lejátszás a projektből, akár később)
  return entries.map((e) => ({
    ...e,
    url: `${e.url}&it=${encodeURIComponent(fileToken(uid, sourceId, e.path ?? ''))}`,
  }));
}

async function streamUserSourceFile(uid, sourceId, rel, res) {
  const source = await findUserSource(uid, sourceId);
  if (!source) {
    res.status(404).json({ error: 'Ismeretlen forrás.' });
    return;
  }
  switch (source.type) {
    case 'gdrive':
      await gdriveStream(source, rel, res);
      return;
    case 'dropbox':
      await dropboxStream(source, rel, res);
      return;
    case 'onedrive':
      await onedriveStream(source, rel, res);
      return;
    case 'webdav':
      await davStream({ ...source.config, id: source.id }, rel, res);
      return;
    case 's3':
      await s3Stream({ ...source.config, id: source.id }, rel, res);
      return;
    default:
      res.status(400).json({ error: `Ismeretlen forrás-típus: ${source.type}` });
  }
}

module.exports = {
  uploadToSource,
  describeUserSources,
  listConnected,
  getDefaultTarget,
  setDefaultTarget,
  listUserSource,
  streamUserSourceFile,
};
