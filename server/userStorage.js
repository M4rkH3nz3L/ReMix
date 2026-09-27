// 🔌 Per-USER külső tárhely-források (Google Drive / Dropbox / WebDAV / S3).
//
// A user a SAJÁT felhőjét köti be a profilról; a média ott marad → NEM terheli a
// mi kvótánkat. A hitelesítés (OAuth token / kulcs) a `user_storage_providers`
// táblában van, és SOHA nem megy a kliensre — a worker (service_role) olvassa és
// PROXYZ. A kliens csak a `/storage/*` végpontokat látja (requireAuth, per-user).
//
// A WebDAV/S3 connectort a régi `storage.js`-ből hasznosítjuk újra; a Drive/Dropbox
// OAuth-connector itt van. Az OAuth env-kapuzott (mint a RevenueCat): kulcsok
// nélkül a `connect` végpont beszédes hibát ad, nem omlik össze.
const crypto = require('crypto');
const fs = require('fs');
const { adminClient } = require('./notify');
const {
  mediaKind,
  davListMedia,
  davStream,
  davUpload,
  s3ListMedia,
  s3Stream,
  s3Upload,
} = require('./storage');

// ───────────────────────────────────────────────────────── OAuth-konfiguráció
const OAUTH = {
  gdrive: {
    label: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    extraAuth: { access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    label: 'Dropbox',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'files.metadata.read files.content.read',
    clientId: () => process.env.DROPBOX_APP_KEY,
    clientSecret: () => process.env.DROPBOX_APP_SECRET,
    extraAuth: { token_access_type: 'offline' },
  },
};

function oauthConfigured(provider) {
  const p = OAUTH[provider];
  return !!(p && p.clientId() && p.clientSecret());
}

const STATE_SECRET =
  process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'insecure-dev-secret';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signState(obj) {
  const payload = b64url(JSON.stringify(obj));
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function verifyState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) {
    return null;
  }
  const expect = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 32);
  if (sig !== expect) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────── DB-hozzáférés (SR)
async function loadUserSources(uid) {
  const sb = adminClient();
  if (!sb || !uid) {
    return [];
  }
  const { data, error } = await sb
    .from('user_storage_providers')
    .select('id, type, label, config, status, is_default')
    .eq('user_id', uid)
    .eq('status', 'connected')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

async function findUserSource(uid, sourceId) {
  return (await loadUserSources(uid)).find((s) => s.id === sourceId) ?? null;
}

async function saveSourceConfig(id, config) {
  const sb = adminClient();
  if (!sb) {
    return;
  }
  await sb.from('user_storage_providers').update({ config }).eq('id', id);
}

async function upsertProvider(uid, { type, label, config }) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('service_role nincs beállítva a workeren.');
  }
  const { data, error } = await sb
    .from('user_storage_providers')
    .insert({ user_id: uid, type, label, config, status: 'connected' })
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data.id;
}

async function disconnectSource(uid, sourceId) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('service_role nincs beállítva a workeren.');
  }
  const { error } = await sb
    .from('user_storage_providers')
    .delete()
    .eq('user_id', uid)
    .eq('id', sourceId);
  if (error) {
    throw new Error(error.message);
  }
}

// ───────────────────────────────────────────────────────── OAuth-folyamat
/** Az authorize-URL, amit a kliens böngészőben megnyit. A `state` aláírva hordja a usert + a redirect_uri-t. */
function oauthStartUrl(uid, provider, redirectBase, returnUrl) {
  const p = OAUTH[provider];
  if (!p) {
    throw new Error(`Ismeretlen OAuth-provider: ${provider}`);
  }
  if (!oauthConfigured(provider)) {
    throw new Error(`A ${p.label} OAuth nincs konfigurálva a workeren (client id/secret).`);
  }
  const redirectUri = `${String(redirectBase).replace(/\/+$/, '')}/storage/oauth/${provider}/callback`;
  const state = signState({ u: uid, r: redirectUri, t: returnUrl || null, p: provider });
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    ...p.extraAuth,
  });
  return { url: `${p.authUrl}?${params.toString()}`, redirectUri };
}

async function exchangeCode(provider, code, redirectUri) {
  const p = OAUTH[provider];
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    redirect_uri: redirectUri,
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token-csere hiba (${res.status})`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

/** Az OAuth-callback feldolgozása: kód → token → DB-sor. Visszaadja a returnUrl-t (deep link). */
async function oauthCallback(provider, code, state) {
  const parsed = verifyState(state);
  if (!parsed || parsed.p !== provider) {
    throw new Error('Érvénytelen OAuth-state.');
  }
  const tokens = await exchangeCode(provider, code, parsed.r);
  await upsertProvider(parsed.u, {
    type: provider,
    label: OAUTH[provider].label,
    config: tokens,
  });
  return parsed.t || null;
}

/** Érvényes access token — lejáratkor frissít és visszaírja a DB-be. */
async function ensureAccessToken(source) {
  const cfg = source.config || {};
  if (cfg.access_token && Number(cfg.expires_at || 0) > Date.now() + 60000) {
    return cfg.access_token;
  }
  const p = OAUTH[source.type];
  if (!p || !cfg.refresh_token) {
    throw new Error('Nincs frissíthető token (újra be kell kötni a forrást).');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refresh_token,
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token-frissítés hiba (${res.status})`);
  }
  const next = {
    ...cfg,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    // Dropbox néha új refresh_tokent ad; ha nem, a régit tartjuk
    refresh_token: data.refresh_token || cfg.refresh_token,
  };
  await saveSourceConfig(source.id, next);
  source.config = next;
  return next.access_token;
}

function mimeKind(mime) {
  if (/^video\//i.test(mime)) return 'video';
  if (/^image\//i.test(mime)) return 'image';
  if (/^audio\//i.test(mime)) return 'audio';
  return null;
}

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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
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

// ───────────────────────────────────────────────────────── Dropbox
async function dropboxListMedia(source) {
  const token = await ensureAccessToken(source);
  const entries = [];
  let res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '', recursive: true, limit: 500 }),
  });
  let data = await res.json().catch(() => ({}));
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
    res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor: data.cursor }),
    });
    data = await res.json().catch(() => ({}));
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Drive feltöltés hiba (${res.status})`);
  }
  return data.id; // a path a Drive file-id
}

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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.path_lower) {
    throw new Error(data.error_summary || `Dropbox feltöltés hiba (${res.status})`);
  }
  return data.path_lower;
}

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

// ── capability-token a /file-hoz: a per-user privát fájl stream-URL-je BEÁGYAZÓDIK
// a projektbe (weben a lejátszó KÉSŐBB is hívja, bearer-fejléc nélkül), ezért
// aláírt, a (user, forrás, út) hármasra kötött, LEJÁRAT NÉLKÜLI capability kell —
// mint egy aláírt S3-URL. Visszavonás: a `user_storage_providers` sor törlésével
// a `findUserSource` már nem találja → a stream elhal.
function fileToken(uid, sourceId, path) {
  const sig = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(`${uid}:${sourceId}:${path}`)
    .digest('hex')
    .slice(0, 32);
  return `${b64url(uid)}.${sig}`;
}
function verifyFileToken(token, sourceId, path) {
  const [uidB64, sig] = String(token || '').split('.');
  if (!uidB64 || !sig) {
    return null;
  }
  let uid;
  try {
    uid = Buffer.from(uidB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const expect = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(`${uid}:${sourceId}:${path}`)
    .digest('hex')
    .slice(0, 32);
  return sig === expect ? uid : null;
}

module.exports = {
  OAUTH,
  oauthConfigured,
  oauthStartUrl,
  oauthCallback,
  fileToken,
  verifyFileToken,
  describeUserSources,
  listConnected,
  listUserSource,
  streamUserSourceFile,
  findUserSource,
  upsertProvider,
  disconnectSource,
  uploadToSource,
  getDefaultTarget,
  setDefaultTarget,
};
