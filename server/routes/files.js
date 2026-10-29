// 🗂️ ReMix Storage route-ok — a user saját, mappás fájl-tára (élesben R2).
//
// Domain-router (01-api-architecture §01.1). Minden route requireAuth; a hívó a
// VERIFIKÁLT tokenből (dev-ben body/query userId fallback). Az objektumok nem
// kapnak publikus URL-t: a letöltés ezen a hitelesített proxyn megy.
//   GET  /files/list?path=        → { path, folders[], files[] }
//   POST /files/folder            { path, name } → { name, path }
//   POST /files/upload            multipart `media` + path [+ md5] → { name, path, size, md5 }
//   GET  /files/download?path=    → a fájl bájtjai (stream)
//   POST /files/delete            { paths[], permanent? } → { removed, bytes } (alap: Lomtárba)
//   POST /files/move              { from, to } → { path, name } (átnevezés is)
//   GET  /files/trash             → { items[], retentionDays, bytes } (lejártak takarítva)
//   POST /files/trash/restore     { ids[] } → { restored[] }
//   POST /files/trash/purge       { ids[] | all:true } → { removed, bytes }
//   🧩 darabolt, folytatható feltöltés (nagy fájlok):
//   POST   /files/upload/init           { path, name, size, md5, contentType? } → { uploadId, partSize, parts } | { deduplicated }
//   GET    /files/upload/:id            → { done[], parts, partSize, size }
//   PUT    /files/upload/:id/part/:n    (nyers bináris darab) → { partNumber }
//   POST   /files/upload/:id/complete   → { name, path, size, md5 }
//   DELETE /files/upload/:id            → { aborted }

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { upload } = require('../lib/upload');
const { BUCKET } = require('../mediastore');
const quota = require('../quota');
const { PART_SIZE, UserFilesError, createUserFiles, filesBucket, resolveBackend } = require('../userFiles');

const router = express.Router();

/** A kvóta-főkönyv; service_role nélkül (dev/teszt) no-op. */
const ledger = {
  wouldExceed: (uid, bytes) => (quota.quotaAvailable() ? quota.wouldExceed(uid, bytes) : { exceeded: false, usage: null }),
  recordObject: (uid, entry) => quota.recordObject(uid, entry),
  forgetObject: (uid, bucket, key) => quota.forgetObject(uid, bucket, key),
  moveObject: (uid, bucket, from, to) => quota.moveObject(uid, bucket, from, to),
};

function service() {
  // főkönyvi címke: a privát files-bucket neve, ha be van állítva; különben a régi
  // média-címke (a már rögzített sorok így továbbra is párosulnak törléskor)
  const backend = resolveBackend();
  const label = backend?.kind === 's3' && (process.env.S3_FILES_BUCKET || '').trim() ? filesBucket() : BUCKET;
  return createUserFiles({ backend, ledger, bucket: label });
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
      res.status(err.status).json({
        error: err.message,
        code: err.code,
        ...(err.usage ? { usage: err.usage } : {}),
        ...(err.missing ? { missing: err.missing } : {}),
      });
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

router.post('/files/upload', requireAuth, rateLimit('upload'), upload.any(), async (req, res) => {
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
    // 🗑️ alapból a Lomtárba (30 napig visszaállítható); `permanent` → azonnali végleges törlés
    const permanent = req.body?.permanent === true;
    let removed = 0;
    let bytes = 0;
    for (const p of paths) {
      const r = permanent ? await svc.remove(uid, p) : await svc.trash(uid, p);
      removed += r.removed;
      bytes += r.bytes;
    }
    res.json({ removed, bytes, trashed: !permanent });
  })
);

router.get(
  '/files/trash',
  requireAuth,
  handle(async (_req, res, uid) => {
    res.json(await service().listTrash(uid));
  })
);

router.post(
  '/files/trash/restore',
  requireAuth,
  rateLimit('messaging'),
  express.json({ limit: '16kb' }),
  handle(async (req, res, uid) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    if (!ids.length) {
      res.status(400).json({ error: 'Nincs kijelölt elem.' });
      return;
    }
    const svc = service();
    const restored = [];
    for (const id of ids) {
      restored.push(await svc.restoreTrash(uid, id));
    }
    res.json({ restored });
  })
);

router.post(
  '/files/trash/purge',
  requireAuth,
  rateLimit('messaging'),
  express.json({ limit: '16kb' }),
  handle(async (req, res, uid) => {
    const ids = req.body?.all === true ? 'all' : Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    if (ids !== 'all' && !ids.length) {
      res.status(400).json({ error: 'Nincs kijelölt elem.' });
      return;
    }
    res.json(await service().purgeTrash(uid, ids));
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

router.post(
  '/files/upload/init',
  requireAuth,
  rateLimit('upload'),
  express.json({ limit: '8kb' }),
  handle(async (req, res, uid) => {
    const b = req.body ?? {};
    res.json(
      await service().uploadInit(uid, b.path, { name: b.name, size: b.size, md5: b.md5, contentType: b.contentType })
    );
  })
);

router.get(
  '/files/upload/:id',
  requireAuth,
  handle(async (req, res, uid) => {
    res.json(await service().uploadStatus(uid, req.params.id));
  })
);

// a darab NYERS bináris body-ként jön (nem multipart) — a méret-plafon a darabméret + tartalék
router.put(
  '/files/upload/:id/part/:n',
  requireAuth,
  rateLimit('upload'),
  express.raw({ type: () => true, limit: PART_SIZE + 1024 * 1024 }),
  handle(async (req, res, uid) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const tmp = path.join(os.tmpdir(), `remix-part-${crypto.randomBytes(8).toString('hex')}`);
    fs.writeFileSync(tmp, body);
    try {
      res.json(await service().uploadPart(uid, req.params.id, req.params.n, tmp));
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  })
);

router.post(
  '/files/upload/:id/complete',
  requireAuth,
  rateLimit('upload'),
  handle(async (req, res, uid) => {
    res.json(await service().uploadComplete(uid, req.params.id));
  })
);

router.delete(
  '/files/upload/:id',
  requireAuth,
  handle(async (req, res, uid) => {
    res.json(await service().uploadAbort(uid, req.params.id));
  })
);

module.exports = router;
