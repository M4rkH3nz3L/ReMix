// 🗂️ ReMix Storage — a user SAJÁT fájl-tára a MI tárhelyünkön (élesben Cloudflare R2).
//
// Projekt-független, mappás fájlkezelő: minden user egy saját prefix alatt
// (`files/<userId>/<mappa>/<fájl>`) tárol. Mappa = kulcs-prefix; az ÜRES mappát egy
// `.folder` jelölő-objektum tartja életben (az S3-nak nincsenek valódi mappái).
//
// A bájtok a meglévő `storage_objects` főkönyvbe kerülnek (project_id = null) → a
// fájlok UGYANAZT a kvótát terhelik, mint a projekt-média (free 1 GiB / Pro 5 GiB
// + koin-boost), és a felhasználó NEM tud kvótán felül tárolni.
//
// Backend (a mediastore-ral azonos sorrend):
//   STORAGE_BACKEND=r2|s3 → S3/R2 · különben USER_FILES_LOCAL_DIR/MEDIA_LOCAL_DIR
//   (dev/teszt, lokális disk) · különben S3, ha be van kötve · különben nincs (503).
// Az objektumokhoz SOHA nem adunk ki publikus URL-t: a letöltés a hitelesített
// `/files/download` proxyn megy (a jogosultságot minden kérésnél a szerver dönti el).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const s3 = require('./s3store');

const MARKER = '.folder';
const MAX_SEGMENT = 120;
const MAX_DEPTH = 20;
const MAX_PATH = 512;
/** egy mappa-törlés/átnevezés legfeljebb ennyi objektumot érint (védőkorlát) */
const MAX_TREE = 1000;

class UserFilesError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'UserFilesError';
    this.status = status;
    this.code = code;
  }
}

const badPath = (msg) => new UserFilesError(400, 'bad_path', msg || 'Érvénytelen útvonal.');
const notFound = () => new UserFilesError(404, 'not_found', 'Nincs ilyen fájl vagy mappa.');

// ── pure út-segédek ───────────────────────────────────────────────────────────

/** Egy név-szegmens ellenőrzése (fájl- vagy mappanév). */
function cleanSegment(raw) {
  const seg = String(raw ?? '').trim();
  if (!seg || seg === '.' || seg === '..' || seg === MARKER) {
    throw badPath('Érvénytelen név.');
  }
  // eslint-disable-next-line no-control-regex
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

function md5OfFile(localPath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(localPath)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

// ── backendek (közös felület) ──────────────────────────────────────────────────
// list(prefix)    → { folders: string[], files: {name,size,modified,etag}[] } (egy szint)
// listAll(prefix) → { key, size }[] (rekurzív, a jelölőkkel együtt)
// head(key)       → { size, modified, etag } | null
// put(key, localPath, contentType) · putEmpty(key) · remove(key) · copy(from, to)
// stream(key)     → { body: Readable, size, contentType } | null

function localBackend(rootDir) {
  const abs = (key) => {
    const p = path.resolve(rootDir, key);
    if (!p.startsWith(path.resolve(rootDir) + path.sep)) {
      throw badPath();
    }
    return p;
  };
  const md5Cache = new Map();
  const etag = async (p, st) => {
    const k = `${p}:${st.size}:${st.mtimeMs}`;
    if (!md5Cache.has(k)) {
      md5Cache.set(k, await md5OfFile(p));
    }
    return md5Cache.get(k);
  };
  const walk = (dir, prefix, out) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, `${prefix}${ent.name}/`, out);
      } else {
        out.push({ key: `${prefix}${ent.name}`, size: fs.statSync(full).size });
      }
    }
    return out;
  };
  return {
    kind: 'local',
    async list(prefix) {
      const dir = abs(prefix);
      if (!fs.existsSync(dir)) {
        return { folders: [], files: [] };
      }
      const folders = [];
      const files = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
          folders.push(ent.name);
        } else if (ent.name !== MARKER) {
          const st = fs.statSync(path.join(dir, ent.name));
          files.push({ name: ent.name, size: st.size, modified: st.mtime.toISOString() });
        }
      }
      return { folders, files };
    },
    async listAll(prefix) {
      const dir = abs(prefix);
      return fs.existsSync(dir) ? walk(dir, prefix, []) : [];
    },
    async head(key) {
      const p = abs(key);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        return null;
      }
      const st = fs.statSync(p);
      return { size: st.size, modified: st.mtime.toISOString(), etag: await etag(p, st) };
    },
    async put(key, localPath) {
      const dest = abs(key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(localPath, dest);
    },
    async putEmpty(key) {
      const dest = abs(key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, '');
    },
    async remove(key) {
      const p = abs(key);
      fs.rmSync(p, { force: true });
      // az üres szülő-mappákat a user gyökeréig felszedjük (S3-paritás)
      let dir = path.dirname(p);
      const stop = path.resolve(rootDir, key.split('/').slice(0, 2).join('/'));
      while (dir.startsWith(stop) && dir !== stop && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }
    },
    async copy(from, to) {
      const dest = abs(to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs(from), dest);
    },
    async stream(key) {
      const p = abs(key);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        return null;
      }
      return { body: fs.createReadStream(p), size: fs.statSync(p).size, contentType: null };
    },
  };
}

function s3Backend() {
  const sdk = require('@aws-sdk/client-s3');
  const send = (cmd) => s3.client().send(cmd);
  const Bucket = s3.BUCKET;
  const isMissing = (err) => err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
  return {
    kind: 's3',
    async list(prefix) {
      const folders = [];
      const files = [];
      let token;
      do {
        const page = await send(
          new sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token, MaxKeys: 1000 })
        );
        for (const cp of page.CommonPrefixes ?? []) {
          const name = (cp.Prefix ?? '').slice(prefix.length).replace(/\/$/, '');
          if (name) {
            folders.push(name);
          }
        }
        for (const obj of page.Contents ?? []) {
          const name = (obj.Key ?? '').slice(prefix.length);
          if (name && name !== MARKER) {
            files.push({
              name,
              size: Number(obj.Size || 0),
              modified: obj.LastModified ? new Date(obj.LastModified).toISOString() : null,
            });
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return { folders, files };
    },
    async listAll(prefix) {
      const out = [];
      let token;
      do {
        const page = await send(new sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const obj of page.Contents ?? []) {
          out.push({ key: obj.Key, size: Number(obj.Size || 0) });
        }
        token = page.IsTruncated && out.length <= MAX_TREE ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async head(key) {
      try {
        const r = await send(new sdk.HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: Number(r.ContentLength || 0),
          modified: r.LastModified ? new Date(r.LastModified).toISOString() : null,
          // egyrészes PUT-nál az ETag = a tartalom MD5-je (R2-n is)
          etag: String(r.ETag || '').replace(/"/g, ''),
        };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    async put(key, localPath, contentType) {
      await s3.uploadFile(key, localPath, contentType);
    },
    async putEmpty(key) {
      await send(new sdk.PutObjectCommand({ Bucket, Key: key, Body: '', ContentLength: 0 }));
    },
    async remove(key) {
      await s3.deleteFile(key);
    },
    async copy(from, to) {
      const src = `${Bucket}/${from.split('/').map(encodeURIComponent).join('/')}`;
      await send(new sdk.CopyObjectCommand({ Bucket, Key: to, CopySource: src }));
    },
    async stream(key) {
      try {
        const r = await send(new sdk.GetObjectCommand({ Bucket, Key: key }));
        return { body: r.Body, size: Number(r.ContentLength || 0), contentType: r.ContentType || null };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
  };
}

/** A futás-időben érvényes backend (a env-et lustán olvassuk → tesztelhető). */
function resolveBackend() {
  const backend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();
  if ((backend === 'r2' || backend === 's3') && s3.s3Enabled()) {
    return s3Backend();
  }
  const localDir = (process.env.USER_FILES_LOCAL_DIR || process.env.MEDIA_LOCAL_DIR || '').trim();
  if (localDir) {
    return localBackend(localDir);
  }
  if (s3.s3Enabled()) {
    return s3Backend();
  }
  return null;
}

// ── műveletek (userId-hez kötve) ───────────────────────────────────────────────

/**
 * @param {object} deps `{ backend, ledger }` — a ledger a kvóta-főkönyv
 *   (`recordObject`, `forgetObject`, `moveObject`, `wouldExceed`); dev-ben/tesztben
 *   lehet no-op. A `bucket` a főkönyvi címke (a mediastore BUCKET-je).
 */
function createUserFiles({ backend, ledger, bucket = 'renders' }) {
  if (!backend) {
    throw new UserFilesError(503, 'storage_unconfigured', 'A ReMix Storage nincs konfigurálva.');
  }

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
      await backend.remove(key).catch(() => {});
      throw new UserFilesError(502, 'verify_failed', 'A feltöltött példány ellenőrzése nem sikerült.');
    }
    try {
      await ledger.recordObject(uid, { projectId: null, bucket, key, bytes, source: 'server' });
    } catch (err) {
      // a kvóta-főkönyv elutasította (verseny) → a tárolt objektumot is visszavonjuk
      await backend.remove(key).catch(() => {});
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
    const fromKey = `${root}${from}`;
    const pairs = [];
    const file = await backend.head(fromKey);
    if (file) {
      pairs.push({ from: fromKey, to: `${root}${to}`, size: file.size });
    } else {
      const tree = await backend.listAll(`${fromKey}/`);
      if (!tree.length) {
        throw notFound();
      }
      if (tree.length > MAX_TREE) {
        throw new UserFilesError(413, 'too_many', 'Túl sok elem egyszerre.');
      }
      for (const obj of tree) {
        pairs.push({ from: obj.key, to: `${root}${to}/${obj.key.slice(fromKey.length + 1)}`, size: obj.size });
      }
    }
    // 1) MINDENT átmásolunk és ellenőrzünk — a forrás csak ezután törlődik
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

module.exports = {
  MARKER,
  UserFilesError,
  normalizePath,
  cleanSegment,
  joinPath,
  parentOf,
  userRoot,
  nextFreeName,
  md5OfFile,
  localBackend,
  resolveBackend,
  createUserFiles,
};
