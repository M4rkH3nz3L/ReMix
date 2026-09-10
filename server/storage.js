// Storage-gateway távoli forrásokhoz (full-plan F2, CUSTOM-STORAGE §18-19):
// a kliens sosem látja a hitelesítést — a worker listáz és proxyz. Új
// forrás-típus = új connector ebben a fájlban; a források a
// server/storage.config.json-ból jönnek (gitignore-olva, lásd a .example fájlt).
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'storage.config.json');

const MEDIA_KINDS = [
  { kind: 'video', re: /\.(mp4|mov|m4v|webm|mkv)$/i },
  { kind: 'image', re: /\.(png|jpe?g|webp|heic|gif)$/i },
  { kind: 'audio', re: /\.(mp3|m4a|wav|aac|ogg|flac)$/i },
];

function mediaKind(name) {
  const hit = MEDIA_KINDS.find((m) => m.re.test(name));
  return hit ? hit.kind : null;
}

/** a konfigurált távoli források (üres lista, ha nincs config) */
function loadSources() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s.id && s.type) : [];
  } catch {
    return [];
  }
}

function findSource(id) {
  return loadSources().find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------- WebDAV

function davAuthHeader(source) {
  if (!source.username) {
    return {};
  }
  const token = Buffer.from(`${source.username}:${source.password ?? ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function davUrl(source, rel) {
  const base = source.baseUrl.replace(/\/+$/, '');
  const root = (source.path ?? '/').replace(/\/+$/, '');
  const relPath = rel
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${base}${root}${relPath ? `/${relPath}` : ''}`;
}

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

/** egy WebDAV-mappa tartalma (Depth: 1) */
async function davListDir(source, rel) {
  const res = await fetch(davUrl(source, rel), {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml', ...davAuthHeader(source) },
    body: PROPFIND_BODY,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(`WebDAV lista hiba (${res.status})`);
  }
  const xml = await res.text();
  const blocks = xml.match(/<(?:\w+:)?response[\s>][\s\S]*?<\/(?:\w+:)?response>/gi) ?? [];
  const items = [];
  for (const block of blocks) {
    const href = block.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/i)?.[1];
    if (!href) {
      continue;
    }
    const decoded = decodeURIComponent(href.replace(/&amp;/g, '&'));
    const isDir = /<(?:\w+:)?collection\s*\/?\s*>/i.test(block);
    const size = parseInt(
      block.match(/<(?:\w+:)?getcontentlength[^>]*>(\d+)</i)?.[1] ?? '0',
      10
    );
    items.push({ href: decoded, isDir, size });
  }
  return items;
}

/**
 * Média-fájlok a forrásból, legfeljebb 2 mappaszint mélyen (max 200 tétel) —
 * relatív úttal, hogy a letöltő-végpont visszatalálja.
 */
async function davListMedia(source) {
  const rootUrl = new URL(davUrl(source, ''));
  const rootPath = rootUrl.pathname.replace(/\/+$/, '');
  const entries = [];

  const toRel = (href) => {
    const p = href.startsWith('http') ? new URL(href).pathname : href;
    const clean = decodeURI(p).replace(/\/+$/, '');
    return clean.startsWith(rootPath) ? clean.slice(rootPath.length) : null;
  };

  const walk = async (rel, depth) => {
    if (entries.length >= 200) {
      return;
    }
    const items = await davListDir(source, rel);
    for (const item of items) {
      const itemRel = toRel(item.href);
      if (itemRel === null || itemRel === rel || itemRel === '') {
        continue; // maga a mappa
      }
      if (item.isDir) {
        if (depth < 2) {
          await walk(itemRel, depth + 1);
        }
        continue;
      }
      const name = itemRel.split('/').pop() ?? itemRel;
      const kind = mediaKind(name);
      if (!kind || entries.length >= 200) {
        continue;
      }
      entries.push({
        id: `${source.id}:${itemRel}`,
        name,
        kind,
        size: item.size || undefined,
        // a kliens ezen az úton kéri a workert — a hitelesítés itt marad
        url: `/storage/${encodeURIComponent(source.id)}/file?path=${encodeURIComponent(itemRel)}`,
        path: itemRel,
      });
    }
  };

  await walk('', 0);
  return entries;
}

/** fájl streamelése a kliensnek — az auth a workeren marad */
async function davStream(source, rel, res) {
  // csak a forrás gyökere alatti út engedett
  if (rel.includes('..')) {
    res.status(400).json({ error: 'Érvénytelen út.' });
    return;
  }
  const upstream = await fetch(davUrl(source, rel), {
    headers: davAuthHeader(source),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: `A forrás nem adta ki a fájlt (${upstream.status}).` });
    return;
  }
  const type = upstream.headers.get('content-type');
  const length = upstream.headers.get('content-length');
  if (type) {
    res.setHeader('Content-Type', type);
  }
  if (length) {
    res.setHeader('Content-Length', length);
  }
  const { Readable } = require('stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

// ---------------------------------------------------------------- S3

/** lusta kliens-létrehozás forrásonként (az SDK csak S3-forrásnál töltődik be) */
const s3Clients = new Map();

function s3Client(source) {
  const cached = s3Clients.get(source.id);
  if (cached) {
    return cached;
  }
  const { S3Client } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: source.region ?? 'us-east-1',
    // S3-kompatibilis tárak (MinIO/R2/B2/Wasabi): endpoint + path-style
    ...(source.endpoint ? { endpoint: source.endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: source.accessKeyId ?? '',
      secretAccessKey: source.secretAccessKey ?? '',
    },
  });
  s3Clients.set(source.id, client);
  return client;
}

async function s3ListMedia(source) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const client = s3Client(source);
  const prefix = (source.prefix ?? '').replace(/^\/+/, '');
  const entries = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: source.bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
        MaxKeys: 200,
      })
    );
    for (const obj of page.Contents ?? []) {
      const key = obj.Key ?? '';
      const name = key.split('/').pop() ?? key;
      const kind = mediaKind(name);
      if (!kind || entries.length >= 200) {
        continue;
      }
      entries.push({
        id: `${source.id}:${key}`,
        name,
        kind,
        size: obj.Size || undefined,
        url: `/storage/${encodeURIComponent(source.id)}/file?path=${encodeURIComponent(key)}`,
        path: key,
      });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && entries.length < 200);
  return entries;
}

async function s3Stream(source, key, res) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client(source);
  const obj = await client.send(
    new GetObjectCommand({ Bucket: source.bucket, Key: key })
  );
  if (obj.ContentType) {
    res.setHeader('Content-Type', obj.ContentType);
  }
  if (obj.ContentLength) {
    res.setHeader('Content-Length', String(obj.ContentLength));
  }
  obj.Body.pipe(res);
}

// ---------------------------------------------------------------- Gateway

/** a Tár panel forrás-listája (hitelesítés nélküli metaadat) */
function describeSources() {
  return loadSources().map((s) => ({
    id: s.id,
    label: s.label ?? s.id,
    type: s.type,
  }));
}

async function listSource(id) {
  const source = findSource(id);
  if (!source) {
    return null;
  }
  if (source.type === 'webdav') {
    return davListMedia(source);
  }
  if (source.type === 's3') {
    return s3ListMedia(source);
  }
  throw new Error(`Ismeretlen forrás-típus: ${source.type}`);
}

async function streamSourceFile(id, rel, res) {
  const source = findSource(id);
  if (!source) {
    res.status(404).json({ error: 'Ismeretlen forrás.' });
    return;
  }
  if (source.type === 'webdav') {
    await davStream(source, rel, res);
    return;
  }
  if (source.type === 's3') {
    await s3Stream(source, rel, res);
    return;
  }
  res.status(400).json({ error: `Ismeretlen forrás-típus: ${source.type}` });
}

module.exports = { describeSources, listSource, streamSourceFile };
