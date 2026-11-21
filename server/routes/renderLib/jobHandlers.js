const { logCaught } = require('../../lib/caught');
// 🔒 GET /render/:id, GET /render/:id/file, POST /render/:id/cancel — a job-állapot, letöltés és megszakítás
// tulaj-ellenőrzéssel (canAccessRenderJob → idegen jobra 404 + biztonsági esemény).
// A kezelők SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/render.js-ben.
const { INSECURE_DEV } = require('../../auth');
const { queueEnabled, getRenderJob, cancelRenderJob } = require('../../queue');
const { streamFile } = require('../../s3store');
const { canAccessRenderJob } = require('../../security/renderAuth');
const { securityEvent } = require('../../security/auditLog');
const { jobs } = require('./jobStore');

// idegen render-jobra: biztonsági-esemény naplózása (14) + 404 (nincs szivárgás)
function denyRenderJob(req, res, ownerId) {
  securityEvent('render.denied', {
    actor: req.user?.id ?? null,
    target: req.params.id,
    meta: { owner: ownerId ?? null },
  });
  res.status(404).json({ error: 'Ismeretlen job.' });
}

// 🔒 BOLA-fix (07): a hívót a renderJobAuth azonosítja (token header/`?t=`), és
// TULAJDONOLT jobhoz csak az egyező user fér — idegenre 404 (a job létezését se
// szivárogtatjuk). Tulajdonos-nélküli jobhoz csak insecure-dev módban (B26).
exports.renderStatusHandler = async (req, res) => {
  // a rövid (lokális) render a jobs-mapben van; a hosszú (felhő) a queue-ban
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id, INSECURE_DEV)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    res.json({ state: job.state, error: job.error, progress: job.progress, degraded: job.degraded });
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch((caught) => { logCaught('routes/render.js', caught); return null; });
    if (j) {
      if (!canAccessRenderJob(j.userId, req.user?.id, INSECURE_DEV)) {
        denyRenderJob(req, res, j.userId);
        return;
      }
      const state = j.state === 'completed' ? 'done' : j.state === 'failed' ? 'error' : 'processing';
      res.json({
        state,
        progress: (j.progress || 0) / 100,
        error: state === 'error' ? j.failedReason : undefined,
        degraded: state === 'done' ? j.returnvalue?.degraded : undefined,
      });
      return;
    }
  }
  res.status(404).json({ error: 'Ismeretlen job.' });
};

exports.renderFileHandler = async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id, INSECURE_DEV)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    if (job.state !== 'done') {
      res.status(404).json({ error: 'A render még nem készült el.' });
      return;
    }
    res.sendFile(job.file);
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch((caught) => { logCaught('routes/render.js', caught); return null; });
    if (j) {
      if (!canAccessRenderJob(j.userId, req.user?.id, INSECURE_DEV)) {
        denyRenderJob(req, res, j.userId);
        return;
      }
      // A38: a kész fájl az API-n át megy (a jogosultság fent ellenőrizve), nem nyilvános
      // tár-linkre irányítva — azt bárki letölthette, akinél a link volt
      if (j.state === 'completed' && j.returnvalue?.outKey) {
        const sent = await streamFile(j.returnvalue.outKey, res).catch((caught) => {
          logCaught('routes/render.js:file', caught);
          return null;
        });
        if (sent === null && !res.headersSent) {
          res.status(502).json({ error: 'A kész fájl nem olvasható a tárból.' });
        }
        if (sent !== false) {
          return;
        }
      }
    }
  }
  res.status(404).json({ error: 'A render még nem készült el.' });
};

// 🛑 Render MEGSZAKÍTÁS (12 §2.3): a kliens ✕-je ide szól → a lokális (in-process)
// render ffmpeg-jét azonnal leállítjuk (AbortController), a sorban VÁRAKOZÓ jobot
// eltávolítjuk. Idempotens: ismeretlen/már-kész jobra is OK (a kliens csak jelez).
// BOLA: renderJobAuth + tulaj-egyezés (idegen jobot nem lehet megszakítani).
exports.renderCancelHandler = async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id, INSECURE_DEV)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    try {
      job.abort?.(); // → az ffmpeg SIGKILL + a temp-mappa törlése a render catch-ágában
    } catch (caught) {
      logCaught('routes/render.js', caught);
      /* már leállt */
    }
    res.json({ ok: true, mode: 'local' });
    return;
  }
  if (queueEnabled()) {
    const r = await cancelRenderJob(req.params.id).catch((caught) => { logCaught('routes/render.js', caught); return null; });
    if (r && r.found) {
      if (!canAccessRenderJob(r.userId, req.user?.id, INSECURE_DEV)) {
        denyRenderJob(req, res, r.userId);
        return;
      }
      res.json({ ok: true, mode: 'queue', removed: r.removed, active: r.active });
      return;
    }
  }
  res.json({ ok: true, mode: 'none' });
};
