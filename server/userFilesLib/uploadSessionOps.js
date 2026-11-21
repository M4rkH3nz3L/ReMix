const { logCaught } = require('../lib/caught');
// 🗂️ ReMix Storage — darabolt, folytatható (multipart) feltöltés-munkamenetek.
const crypto = require('crypto');
const fs = require('fs');

const { UPLOAD_SESSION_DAYS } = require('./constants');
const { UserFilesError, badPath } = require('./errors');
const { cleanSegment, joinPath, nextFreeName, normalizePath, userRoot, userUploads } = require('./paths');

/** @param {object} deps `{ backend, ledger, bucket, partSize }` (lásd createUserFiles) */
function createUploadSessionOps({ backend, ledger, bucket, partSize }) {
  // ── 🧩 Darabolt, folytatható feltöltés ──────────────────────────────────────
  // init → (part × N, bármikor folytatható; status megmondja, mi van már fent) →
  // complete (méret + teljes MD5 ellenőrzés, végleges név, kvóta-rögzítés) | abort.
  // A darabok egy rejtett staging-kulcsra mennek; a munkamenet a user prefixe alatt él.

  const cleanSession = (sid) => {
    const v = String(sid ?? '');
    if (!/^[a-f0-9]{32}$/.test(v)) {
      throw badPath('Érvénytelen feltöltés-azonosító.');
    }
    return v;
  };

  async function readSession(uid, sid) {
    const raw = await backend.readText(`${userUploads(uid)}${cleanSession(sid)}.json`);
    if (!raw) {
      throw new UserFilesError(404, 'upload_not_found', 'A feltöltés-munkamenet lejárt vagy nem létezik.');
    }
    return JSON.parse(raw);
  }

  const partCount = (size) => Math.max(1, Math.ceil(size / partSize));
  const partLength = (size, n) => (n < partCount(size) ? partSize : size - (partCount(size) - 1) * partSize);

  /** a régi (félbehagyott) munkamenetek takarítása — best-effort */
  async function sweepSessions(uid, now) {
    const { files } = await backend.list(userUploads(uid)).catch((caught) => { logCaught('userFiles.js:sweepSessions', caught); return { files: [] }; });
    for (const f of files.filter((x) => x.name.endsWith('.json'))) {
      const raw = await backend.readText(`${userUploads(uid)}${f.name}`).catch((caught) => { logCaught('userFiles.js:sweepSessions', caught); return null; });
      const sess = raw ? JSON.parse(raw) : null;
      if (!sess || now - Date.parse(sess.createdAt) > UPLOAD_SESSION_DAYS * 86400000) {
        if (sess) {
          await backend.mpAbort(sess.staging, sess.backendId).catch((caught) => { logCaught('userFiles.js:sweepSessions', caught); });
        }
        await backend.remove(`${userUploads(uid)}${f.name}`).catch((caught) => { logCaught('userFiles.js:sweepSessions', caught); });
      }
    }
  }

  async function uploadInit(uid, rawDir, { name: rawName, size, md5, contentType }, now = Date.now()) {
    const dir = normalizePath(rawDir);
    const name = cleanSegment(rawName);
    const bytes = Math.trunc(Number(size));
    if (!(bytes > 0)) {
      throw badPath('Érvénytelen méret.');
    }
    const sum = String(md5 ?? '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(sum)) {
      throw badPath('Hiányzó vagy érvénytelen MD5.');
    }
    normalizePath(joinPath(dir, name));
    await sweepSessions(uid, now);
    // idempotencia: ugyanaz a fájl már fent van → nincs új feltöltés
    const prefix = dir ? `${userRoot(uid)}${dir}/` : userRoot(uid);
    const existing = await backend.list(prefix);
    if (existing.files.some((f) => f.name === name && f.size === bytes)) {
      const head = await backend.head(`${prefix}${name}`);
      if (head && head.etag === sum) {
        return { deduplicated: true, name, path: joinPath(dir, name), size: bytes, md5: sum };
      }
    }
    const pre = await ledger.wouldExceed(uid, bytes);
    if (pre.exceeded) {
      throw Object.assign(new UserFilesError(507, 'quota_exceeded', 'Betelt a tárhelyed.'), { usage: pre.usage });
    }
    const sid = crypto.randomBytes(16).toString('hex');
    const staging = `${userUploads(uid)}${sid}.data`;
    const backendId = await backend.mpInit(staging, contentType);
    const session = { dir, name, size: bytes, md5: sum, contentType: contentType || null, staging, backendId, partSize, createdAt: new Date(now).toISOString() };
    await backend.putText(`${userUploads(uid)}${sid}.json`, JSON.stringify(session));
    return { uploadId: sid, partSize, parts: partCount(bytes) };
  }

  async function uploadStatus(uid, sid) {
    const sess = await readSession(uid, sid);
    const parts = (await backend.mpListParts(sess.staging, sess.backendId)) ?? [];
    return {
      uploadId: cleanSession(sid),
      size: sess.size,
      partSize: sess.partSize,
      parts: partCount(sess.size),
      // csak a HELYES méretű darab számít késznek (a csonka újraküldendő)
      done: parts.filter((pt) => pt.size === partLength(sess.size, pt.partNumber)).map((pt) => pt.partNumber),
    };
  }

  async function uploadPart(uid, sid, rawN, localPath) {
    const sess = await readSession(uid, sid);
    const n = Number(rawN);
    if (!Number.isInteger(n) || n < 1 || n > partCount(sess.size)) {
      throw badPath('Érvénytelen darab-sorszám.');
    }
    const got = fs.statSync(localPath).size;
    if (got !== partLength(sess.size, n)) {
      throw new UserFilesError(400, 'bad_part', `A darab mérete hibás (${got} ≠ ${partLength(sess.size, n)}).`);
    }
    await backend.mpPart(sess.staging, sess.backendId, n, localPath);
    return { partNumber: n };
  }

  async function uploadComplete(uid, sid) {
    const sess = await readSession(uid, sid);
    const parts = (await backend.mpListParts(sess.staging, sess.backendId)) ?? [];
    const total = partCount(sess.size);
    const ok = new Map(parts.filter((pt) => pt.size === partLength(sess.size, pt.partNumber)).map((pt) => [pt.partNumber, pt]));
    const missing = [];
    for (let i = 1; i <= total; i++) {
      if (!ok.has(i)) {
        missing.push(i);
      }
    }
    if (missing.length) {
      throw Object.assign(new UserFilesError(409, 'parts_missing', 'Még nem érkezett meg minden darab.'), { missing });
    }
    await backend.mpComplete(sess.staging, sess.backendId, [...ok.values()].sort((a, b) => a.partNumber - b.partNumber));
    // ✅ teljes ellenőrzés: méret + a TELJES tartalom MD5-je (a kliens init-kori MD5-jével)
    const head = await backend.head(sess.staging);
    const stream = await backend.stream(sess.staging);
    const sum = stream
      ? await new Promise((resolve, reject) => {
          const h = crypto.createHash('md5');
          stream.body.on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
        })
      : null;
    if (!head || head.size !== sess.size || sum !== sess.md5) {
      await backend.remove(sess.staging).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
      await backend.remove(`${userUploads(uid)}${cleanSession(sid)}.json`).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
      throw new UserFilesError(422, 'checksum_mismatch', 'A fájl sérülten érkezett meg — próbáld újra.');
    }
    // végleges név (ütközés → „név (1)”), másolás a helyére, ellenőrzés, staging törlése
    const prefix = sess.dir ? `${userRoot(uid)}${sess.dir}/` : userRoot(uid);
    const existing = await backend.list(prefix);
    const finalName = nextFreeName(sess.name, new Set([...existing.files.map((f) => f.name), ...existing.folders]));
    const p = joinPath(sess.dir, finalName);
    const key = `${userRoot(uid)}${p}`;
    await backend.copy(sess.staging, key);
    const done = await backend.head(key);
    if (!done || done.size !== sess.size) {
      await backend.remove(key).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
      throw new UserFilesError(502, 'verify_failed', 'A feltöltött példány ellenőrzése nem sikerült.');
    }
    try {
      await ledger.recordObject(uid, { projectId: null, bucket, key, bytes: sess.size, source: 'server' });
    } catch (err) {
      await backend.remove(key).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
      throw err;
    }
    await backend.remove(sess.staging).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
    await backend.remove(`${userUploads(uid)}${cleanSession(sid)}.json`).catch((caught) => { logCaught('userFiles.js:uploadComplete', caught); });
    return { name: finalName, path: p, size: sess.size, md5: sess.md5, deduplicated: false };
  }

  async function uploadAbort(uid, sid) {
    const sess = await readSession(uid, sid).catch((caught) => { logCaught('userFiles.js:uploadAbort', caught); return null; });
    if (sess) {
      await backend.mpAbort(sess.staging, sess.backendId).catch((caught) => { logCaught('userFiles.js:uploadAbort', caught); });
      await backend.remove(sess.staging).catch((caught) => { logCaught('userFiles.js:uploadAbort', caught); });
    }
    await backend.remove(`${userUploads(uid)}${cleanSession(sid)}.json`).catch((caught) => { logCaught('userFiles.js:uploadAbort', caught); });
    return { aborted: true };
  }

  return { uploadInit, uploadStatus, uploadPart, uploadComplete, uploadAbort };
}

module.exports = { createUploadSessionOps };
