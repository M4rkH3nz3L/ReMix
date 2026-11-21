const { logCaught } = require('../lib/caught');
// 🔌 Külső tárhely — OneDrive (Microsoft Graph) connector: listázás, stream-proxy, feltöltés.
const fs = require('fs');
const { fetchRetry } = require('../netFetch');
const { mediaKind } = require('../storage');
const { ensureAccessToken } = require('./oauthFlow');
const { mimeKind } = require('./mimeKind');

// ───────────────────────────────────────────────────────── OneDrive (Microsoft Graph)
async function onedriveListMedia(source) {
  const token = await ensureAccessToken(source);
  const url =
    'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200&$select=id,name,size,file,folder';
  const res = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:onedriveListMedia', caught); return {}; });
  if (!res.ok) {
    throw new Error(data.error?.message || `OneDrive lista hiba (${res.status})`);
  }
  const entries = [];
  for (const f of data.value ?? []) {
    if (f.folder) {
      continue; // mappát kihagyunk (a gyökér-szint médiáját listázzuk)
    }
    const kind = mimeKind(f.file?.mimeType || '') || mediaKind(f.name);
    if (!kind) {
      continue;
    }
    entries.push({
      id: `${source.id}:${f.id}`,
      name: f.name,
      kind,
      size: f.size ? Number(f.size) : undefined,
      url: `/storage/${encodeURIComponent(source.id)}/file?path=${encodeURIComponent(f.id)}`,
      path: f.id,
    });
  }
  return entries;
}

async function onedriveStream(source, itemId, res) {
  const token = await ensureAccessToken(source);
  const upstream = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: `A OneDrive nem adta ki a fájlt (${upstream.status}).` });
    return;
  }
  const type = upstream.headers.get('content-type');
  const length = upstream.headers.get('content-length');
  if (type) res.setHeader('Content-Type', type);
  if (length) res.setHeader('Content-Length', length);
  const { Readable } = require('stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

// ── Írás (upload)
async function onedriveUpload(source, localPath, name) {
  const token = await ensureAccessToken(source);
  const body = fs.readFileSync(localPath);
  // egyszerű feltöltés (PUT .../content) a /ReMix mappába; az út a visszakapott itemId
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/ReMix/${encodeURIComponent(name)}:/content`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body,
    }
  );
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:onedriveUpload', caught); return {}; });
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `OneDrive feltöltés hiba (${res.status})`);
  }
  return data.id;
}

module.exports = { onedriveListMedia, onedriveStream, onedriveUpload };
