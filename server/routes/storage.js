// 🗄️ Külső tárhely-provider route-ok (Drive/Dropbox/WebDAV/S3 + aktív-cél + proxy).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből
// — a viselkedés változatlan (a hitelesítés/kulcsok a workeren maradnak, minden
// route requireAuth kivéve a capability-tokenes /file proxy; a 401/404/502
// precedencia megőrizve). A séma-validáció itt NEM kerül be: a handlerek a 401-et a
// mező-ellenőrzés előtt adják. A `./storage` → `../storage` útvonal a sub-mappa miatt.

const { execFile } = require('child_process');
const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const userStorage = require('../userStorage');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

const router = express.Router();

// A user sajátjai + a legacy globális admin-források (ha be van állítva config).
router.get('/storage/sources', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  try {
    const { describeSources } = require('../storage');
    const user = uid ? await userStorage.describeUserSources(uid) : [];
    res.json({ sources: [...user, ...describeSources()] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A user bekötött külső forrásai a profil-kezeléshez (státusszal, globális nélkül).
router.get('/storage/connected', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const [providers, defaultTarget] = await Promise.all([
      userStorage.listConnected(uid),
      userStorage.getDefaultTarget(uid),
    ]);
    res.json({ providers, default: defaultTarget });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🎯 Az AKTÍV tárhely-cél beállítása: { sourceId } (null/üres → ReMix-tárhely).
router.post('/storage/default', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const sourceId = req.body?.sourceId ? String(req.body.sourceId) : null;
    await userStorage.setDefaultTarget(uid, sourceId);
    res.json({ ok: true, default: sourceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔑 Külső forrás bekötése — OAuth (Drive/Dropbox): authorize-URL-t ad vissza.
router.post('/storage/oauth/:provider/start', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const redirectBase =
      process.env.OAUTH_REDIRECT_BASE || `${req.protocol}://${req.get('host')}`;
    const { url } = userStorage.oauthStartUrl(
      uid,
      req.params.provider,
      redirectBase,
      typeof req.body?.returnUrl === 'string' ? req.body.returnUrl : null
    );
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OAuth-callback: a szolgáltató IDE tér vissza (a state hordja a usert).
router.get('/storage/oauth/:provider/callback', async (req, res) => {
  const { code, state, error: oauthErr } = req.query;
  if (oauthErr) {
    res.status(400).send(`OAuth hiba: ${String(oauthErr)}`);
    return;
  }
  try {
    const ret = await userStorage.oauthCallback(
      req.params.provider,
      String(code || ''),
      String(state || '')
    );
    const target = ret ? String(ret) : '';
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      `<!doctype html><meta charset="utf-8"><title>Kész</title>` +
        `<body style="font-family:system-ui;padding:2rem;text-align:center">` +
        `<h2>✅ Tárhely bekötve</h2><p>Bezárhatod ezt az ablakot.</p>` +
        (target ? `<script>location.replace(${JSON.stringify(target)})</script>` : '') +
        `</body>`
    );
  } catch (err) {
    res.status(400).send(`Bekötés sikertelen: ${err.message}`);
  }
});

// Manuális forrás (WebDAV/S3): a kulcsokat a kliens küldi, a workeren tároljuk.
router.post('/storage/connect', requireAuth, rateLimit('messaging'), express.json({ limit: '8kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  const type = String(req.body?.type || '');
  if (!['webdav', 's3'].includes(type)) {
    res.status(400).json({ error: 'Csak webdav/s3 köthető be manuálisan (Drive/Dropbox: OAuth).' });
    return;
  }
  try {
    const id = await userStorage.upsertProvider(uid, {
      type,
      label: String(req.body?.label || type),
      config: req.body?.config || {},
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/storage/:sourceId/disconnect', requireAuth, rateLimit('messaging'), async (req, res) => {
  const uid = callerId(req, req.query.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  try {
    await userStorage.disconnectSource(uid, req.params.sourceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/storage/:sourceId/list', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  const { listSource } = require('../storage');
  try {
    let entries = uid ? await userStorage.listUserSource(uid, req.params.sourceId) : null;
    if (entries === null) {
      entries = await listSource(req.params.sourceId);
    }
    if (entries === null) {
      res.status(404).json({ error: 'Ismeretlen forrás.' });
      return;
    }
    res.json({ entries });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// hossz-lekérdezés hozzáadás előtt: az ffprobe a saját gateway-URL-t olvassa.
router.get('/storage/:sourceId/probe', requireAuth, (req, res) => {
  const uid = callerId(req, req.query.userId);
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  const it = uid
    ? `&it=${encodeURIComponent(userStorage.fileToken(uid, req.params.sourceId, rel))}`
    : '';
  const selfUrl = `http://127.0.0.1:${PORT}/storage/${encodeURIComponent(
    req.params.sourceId
  )}/file?path=${encodeURIComponent(rel)}${it}`;
  execFile(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', selfUrl],
    { timeout: 60 * 1000 },
    (err, stdout) => {
      if (err) {
        res.json({ duration: null });
        return;
      }
      const duration = parseFloat((stdout ?? '').trim());
      res.json({ duration: Number.isFinite(duration) ? duration : null });
    }
  );
});

// A /file NEM használ requireAuth-ot: a stream-URL beágyazódik a projektbe és a
// lejátszó bearer nélkül hívja → a hozzáférés capability-token (`it`) VAGY user.
router.get('/storage/:sourceId/file', (req, res) => {
  const { streamSourceFile } = require('../storage');
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  let uid = callerId(req, null);
  if (!uid && typeof req.query.it === 'string') {
    uid = userStorage.verifyFileToken(req.query.it, req.params.sourceId, rel);
  }
  (async () => {
    const own = uid ? await userStorage.findUserSource(uid, req.params.sourceId) : null;
    if (own) {
      await userStorage.streamUserSourceFile(uid, req.params.sourceId, rel, res);
    } else {
      await streamSourceFile(req.params.sourceId, rel, res);
    }
  })().catch((err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    }
  });
});

module.exports = router;
