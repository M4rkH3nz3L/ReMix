// 🗂️ ReMix Storage route-ok — a user saját, mappás fájl-tára (élesben R2).
//
// Domain-router (01-api-architecture §01.1). Minden route requireAuth; a hívó a
// VERIFIKÁLT tokenből (dev-ben body/query userId fallback). Az objektumok nem
// kapnak publikus URL-t: a letöltés ezen a hitelesített proxyn megy.
//   GET  /files/list?path=        → { path, folders[], files[] }
//   POST /files/folder            { path, name } → { name, path }
//   POST /files/upload            multipart `media` + path [+ md5] → { name, path, size, md5 }
//   GET  /files/download?path=    → a fájl bájtjai (stream)
//   POST /files/delete            { paths[] } → { removed, bytes }
//   POST /files/move              { from, to } → { path, name } (átnevezés is)

const fs = require('fs');
const path = require('path');
const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { upload } = require('../lib/upload');
const { BUCKET } = require('../mediastore');
const quota = require('../quota');
const { UserFilesError, createUserFiles, resolveBackend } = require('../userFiles');

const router = express.Router();

/** A kvóta-főkönyv; service_role nélkül (dev/teszt) no-op. */
const ledger = {
  wouldExceed: (uid, bytes) => (quota.quotaAvailable() ? quota.wouldExceed(uid, bytes) : { exceeded: false, usage: null }),
  recordObject: (uid, entry) => quota.recordObject(uid, entry),
  forgetObject: (uid, bucket, key) => quota.forgetObject(uid, bucket, key),
  moveObject: (uid, bucket, from, to) => quota.moveObject(uid, bucket, from, to),
};

function service() {
  return createUserFiles({ backend: resolveBackend(), ledger, bucket: BUCKET });
}

/** Async handler + egységes hibaválasz (Express 4 nem kapja el az async-dobást). */
const handle = (fn) => async (req, res) => {
  const uid = callerId(req, req.body?.userId ?? req.query.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  try {
    await fn(req, res, uid);
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof UserFilesError) {
      res.status(err.status).json({ error: err.message, code: err.code, ...(err.usage ? { usage: err.usage } : {}) });
      return;
    }
    if (err instanceof quota.QuotaExceededError) {
      res.status(507).json({ error: 'Betelt a tárhelyed.', code: 'quota_exceeded', usage: err.usage });
      return;
    }
    console.error('[files] hiba:', err.message);
    res.status(500).json({ error: 'A tárhely-művelet nem sikerült.' });
  }
};

router.get(
  '/files/list',
  requireAuth,
  handle(async (req, res, uid) => {
    res.json(await service().list(uid, req.query.path));
  })
);

router.post(
  '/files/folder',
  requireAuth,
  rateLimit('messaging'),
  express.json({ limit: '4kb' }),
  handle(async (req, res, uid) => {
    res.json(await service().mkdir(uid, req.body?.path, req.body?.name));
  })
);

router.post('/files/upload', upload.any(), requireAuth, rateLimit('upload'), async (req, res) => {
  const f = (req.files ?? [])[0];
  try {
    if (!f) {
      res.status(400).json({ error: 'nincs fájl' });
      return;
    }
    await handle(async (_req, r, uid) => {
      const out = await service().upload(uid, req.body?.path, {
        localPath: f.path,
        name: req.body?.name || f.originalname || path.basename(f.path),
        contentType: f.mimetype,
        md5: req.body?.md5,
      });
      r.json(out);
    })(req, res);
  } finally {
    if (req.workDir) {
      fs.rm(req.workDir, { recursive: true, force: true }, () => {});
    }
  }
});

router.get(
  '/files/download',
  requireAuth,
  handle(async (req, res, uid) => {
    const file = await service().open(uid, req.query.path);
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    if (file.size) {
      res.setHeader('Content-Length', String(file.size));
    }
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    file.body.on('error', () => res.destroy());
    file.body.pipe(res);
  })
);

router.post(
  '/files/delete',
  requireAuth,
  rateLimit('messaging'),
  express.json({ limit: '64kb' }),
  handle(async (req, res, uid) => {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 200) : [];
    if (!paths.length) {
      res.status(400).json({ error: 'Nincs kijelölt elem.' });
      return;
    }
    const svc = service();
    let removed = 0;
    let bytes = 0;
    for (const p of paths) {
      const r = await svc.remove(uid, p);
      removed += r.removed;
      bytes += r.bytes;
    }
    res.json({ removed, bytes });
  })
);

router.post(
  '/files/move',
  requireAuth,
  rateLimit('messaging'),
  express.json({ limit: '4kb' }),
  handle(async (req, res, uid) => {
    res.json(await service().move(uid, req.body?.from, req.body?.to));
  })
);

module.exports = router;
