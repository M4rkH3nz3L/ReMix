// 🗂️ ReMix Storage — a lokális disk-backend (dev/teszt; USER_FILES_LOCAL_DIR / MEDIA_LOCAL_DIR).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { MARKER } = require('./constants');
const { badPath, notFound } = require('./errors');
const { md5OfFile } = require('./md5');

// ── backendek (közös felület) ──────────────────────────────────────────────────
// list(prefix)    → { folders: string[], files: {name,size,modified,etag}[] } (egy szint)
// listAll(prefix) → { key, size }[] (rekurzív, a jelölőkkel együtt)
// head(key)       → { size, modified, etag } | null
// put(key, localPath, contentType) · putEmpty(key) · remove(key) · copy(from, to)
// stream(key)     → { body: Readable, size, contentType } | null
// putText(key, text) · readText(key) → string | null   (kis metaadat-fájlokhoz)

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
    async putText(key, text) {
      const dest = abs(key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text);
    },
    async readText(key) {
      const p = abs(key);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    },
    // multipart: a darabok egy rejtett munka-mappában (`.mp/<id>/<n>`), lezáráskor összefűzve
    async mpInit() {
      const id = crypto.randomBytes(8).toString('hex');
      fs.mkdirSync(path.join(rootDir, '.mp', id), { recursive: true });
      return id;
    },
    async mpPart(_key, id, partNumber, localPath) {
      const dir = path.join(rootDir, '.mp', id);
      if (!fs.existsSync(dir)) {
        throw notFound();
      }
      fs.copyFileSync(localPath, path.join(dir, String(partNumber)));
      return md5OfFile(localPath);
    },
    async mpListParts(_key, id) {
      const dir = path.join(rootDir, '.mp', id);
      if (!fs.existsSync(dir)) {
        return null;
      }
      return fs
        .readdirSync(dir)
        .map((n) => ({ partNumber: Number(n), size: fs.statSync(path.join(dir, n)).size }))
        .filter((x) => Number.isInteger(x.partNumber))
        .sort((a, b) => a.partNumber - b.partNumber);
    },
    async mpComplete(key, id, parts) {
      const dir = path.join(rootDir, '.mp', id);
      const dest = abs(key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, '');
      for (const pt of parts) {
        fs.appendFileSync(dest, fs.readFileSync(path.join(dir, String(pt.partNumber))));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async mpAbort(_key, id) {
      fs.rmSync(path.join(rootDir, '.mp', id), { recursive: true, force: true });
    },
  };
}

module.exports = { localBackend };
