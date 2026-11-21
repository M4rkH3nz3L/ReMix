const { logCaught } = require('../lib/caught');
// 🔌 Külső tárhely — Google Drive connector: listázás, stream-proxy, feltöltés.
const crypto = require('crypto');
const fs = require('fs');
const { fetchRetry } = require('../netFetch');
const { mediaKind } = require('../storage');
const { ensureAccessToken } = require('./oauthFlow');
const { mimeKind } = require('./mimeKind');

// ───────────────────────────────────────────────────────── Google Drive
async function gdriveListMedia(source) {
  const token = await ensureAccessToken(source);
  const q =
    "trashed=false and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType contains 'audio/')";
  const url =
    'https://www.googleapis.com/drive/v3/files?' +
    new URLSearchParams({
      q,
      fields: 'files(id,name,size,mimeType)',
      pageSize: '200',
      orderBy: 'modifiedTime desc',
    }).toString();
  // listázás: idempotens GET → időkorlát + retry átmeneti hibára
  const res = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:gdriveListMedia', caught); return {}; });
  if (!res.ok) {
    throw new Error(data.error?.message || `Drive lista hiba (${res.status})`);
  }
  const entries = [];
  for (const f of data.files ?? []) {
    const kind = mimeKind(f.mimeType) || mediaKind(f.name);
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

async function gdriveStream(source, fileId, res) {
  const token = await ensureAccessToken(source);
  const upstream = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: `A Drive nem adta ki a fájlt (${upstream.status}).` });
    return;
  }
  const type = upstream.headers.get('content-type');
  const length = upstream.headers.get('content-length');
  if (type) res.setHeader('Content-Type', type);
  if (length) res.setHeader('Content-Length', length);
  const { Readable } = require('stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

// ───────────────────────────────────────────────────────── Írás (upload)
async function gdriveUpload(source, localPath, name, contentType) {
  const token = await ensureAccessToken(source);
  const media = fs.readFileSync(localPath);
  const boundary = `remix${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify({ name })),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`),
    media,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  const data = await res.json().catch((caught) => { logCaught('userStorage.js:gdriveUpload', caught); return {}; });
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Drive feltöltés hiba (${res.status})`);
  }
  return data.id; // a path a Drive file-id
}

module.exports = { gdriveListMedia, gdriveStream, gdriveUpload };
