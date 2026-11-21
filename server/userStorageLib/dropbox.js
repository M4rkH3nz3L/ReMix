const { logCaught } = require('../lib/caught');
// 🔌 Külső tárhely — Dropbox connector: listázás (lapozva), stream-proxy, feltöltés.
const fs = require('fs');
const { fetchRetry } = require('../netFetch');
const { mediaKind } = require('../storage');
const { ensureAccessToken } = require('./oauthFlow');

// ───────────────────────────────────────────────────────── Dropbox
async function dropboxListMedia(source) {
  const token = await ensureAccessToken(source);
  const entries = [];
  // listázás: read-only POST → idempotensként kezeljük (időkorlát + retry)
  let res = await fetchRetry(
    'https://api.dropboxapi.com/2/files/list_folder',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: true, limit: 500 }),
    },
    { idempotent: true }
  );
  let data = await res.json().catch((caught) => { logCaught('userStorage.js:dropboxListMedia', caught); return {}; });
  if (!res.ok) {
    throw new Error(data.error_summary || `Dropbox lista hiba (${res.status})`);
  }
  const collect = (list) => {
    for (const e of list ?? []) {
      if (e['.tag'] !== 'file' || entries.length >= 200) {
        continue;
      }
      const kind = mediaKind(e.name);
      if (!kind) {
        continue;
      }
      entries.push({
        id: `${source.id}:${e.path_lower}`,
        name: e.name,
        kind,
        size: e.size ? Number(e.size) : undefined,
        url: `/storage/${encodeURIComponent(source.id)}/file?path=${encodeURIComponent(e.path_lower)}`,
        path: e.path_lower,
      });
    }
  };
  collect(data.entries);
  while (data.has_more && entries.length < 200) {
    res = await fetchRetry(
      'https://api.dropboxapi.com/2/files/list_folder/continue',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor: data.cursor }),
      },
      { idempotent: true }
    );
    data = await res.json().catch((caught) => { logCaught('userStorage.js:dropboxListMedia', caught); return {}; });
    if (!res.ok) {
      break;
    }
    collect(data.entries);
  }
  return entries;
}

async function dropboxStream(source, path, res) {
  const token = await ensureAccessToken(source);
  const upstream = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) },
  });
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: `A Dropbox nem adta ki a fájlt (${upstream.status}).` });
    return;
  }
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  const { Readable } = require('stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

// ── Írás (upload)
async function dropboxUpload(source, localPath, name) {
  const token = await ensureAccessToken(source);
  const body = fs.readFileSync(localPath);
  const path = `/ReMix/${name}`;
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: true, mute: true }),
    },
    body,
  });
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:dropboxUpload', caught); return {}; });
  if (!res.ok || !data.path_lower) {
    throw new Error(data.error_summary || `Dropbox feltöltés hiba (${res.status})`);
  }
  return data.path_lower;
}

module.exports = { dropboxListMedia, dropboxStream, dropboxUpload };
