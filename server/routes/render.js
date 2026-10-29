// 🎬 Render route-ok + lokális job-állapot (render/proxy/collect/queue/:id*).
//
// Domain-router (01-api-architecture §01.1). A handlerek + a `jobs` in-memory map
// + a view/workerView/denyRenderJob helperek SZÓ SZERINT az index.js-ből — a BOLA-
// ellenőrzés (canAccessRenderJob → 404 idegen jobra), a kooperatív abort és a
// queue/local kettősség változatlan.

const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { requireAuth, INSECURE_DEV } = require('../auth');
const { paidOnly, renderJobAuth } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { upload } = require('../lib/upload');
const { renderProject, MAX_RENDER_DURATION_SEC } = require('../render');
const { queueEnabled, enqueueRender, getRenderJob, cancelRenderJob, listRenderJobs, renderConcurrency } = require('../queue');
const { listWorkers } = require('../workers-registry');
const { s3Enabled, uploadFile, publicUrl } = require('../s3store');
const { canAccessRenderJob } = require('../security/renderAuth');
const { securityEvent } = require('../security/auditLog');
const { trackUsage, userTier, enforceQuota } = require('../usage');

const router = express.Router();
const jobs = new Map(); // id → { state, file?, error?, dir, userId?, abort? }

router.post('/render', ...paidOnly, upload.any(), (req, res) => {
  let project;
  let uriMap;
  try {
    project = JSON.parse(req.body.project);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch {
    res.status(400).json({ error: 'Hibás project/uriMap JSON.' });
    return;
  }
  const workDir = req.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));

  // a klip-uri-k átírása a feltöltött fájlokra
  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  const missing = [];
  for (const track of project.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
        const field = uriMap[clip.uri];
        const file = field ? fieldToFile.get(field) : null;
        if (file) {
          clip.uri = file;
        } else {
          missing.push(clip.id);
        }
      }
      // kép-kitöltésű forma (logó/watermark) — a képfájl is feltöltve érkezik
      if (clip.kind === 'shape' && clip.imageUri) {
        const field = uriMap[clip.imageUri];
        const file = field ? fieldToFile.get(field) : null;
        if (file) {
          clip.imageUri = file;
        } else {
          missing.push(clip.id);
        }
      }
      // 🛡️ A matte és a LUT is az FFmpeg `-i`-jére / `lut3d`-jébe megy. Ezek
      // eddig KIMARADTAK az átírásból, így a kliens által küldött nyers érték
      // jutott az FFmpeg-hez — az pedig érti a http(s):// és file:// sémát is:
      // belső HTTP-kérés kényszeríthető, vagy a worker gépén lévő tetszőleges
      // kép/LUT beleégethető a kimenetbe (amit a támadó letölt). Most csak
      // FELTÖLTÖTT fájlra mutathatnak; ismeretlen cím → a kérés elutasítva.
      if (clip.matte && clip.matte.uri) {
        const field = uriMap[clip.matte.uri];
        const file = field ? fieldToFile.get(field) : null;
        if (file) {
          clip.matte.uri = file;
        } else {
          missing.push(`${clip.id} (matte)`);
        }
      }
      if (clip.adjust && clip.adjust.lut && clip.adjust.lut.uri) {
        const field = uriMap[clip.adjust.lut.uri];
        const file = field ? fieldToFile.get(field) : null;
        if (file) {
          clip.adjust.lut.uri = file;
        } else {
          missing.push(`${clip.id} (LUT)`);
        }
      }
    }
  }
  if (missing.length > 0) {
    res.status(400).json({ error: `Hiányzó médiafájlok: ${missing.join(', ')}` });
    return;
  }

  let settingsRaw = {};
  try {
    settingsRaw = JSON.parse(req.body.settings ?? '{}');
  } catch {
    // alapértékek
  }

  // Dispatch: a RÖVID (≤ küszöb, alap 15 mp) videók a LOKÁLIS szerveren renderelnek
  // (nincs queue/S3 kör-idő, azonnal indul); a HOSSZABBAK a FELHŐBEN (skálázható
  // worker-pool). A küszöb env-vel állítható (CLOUD_RENDER_MIN_SEC).
  const CLOUD_MIN_SEC = parseInt(process.env.CLOUD_RENDER_MIN_SEC || '15', 10);
  const totalDuration = Math.max(
    0,
    ...(project.tracks ?? []).flatMap((t) =>
      (t.clips ?? []).map((c) => (c.start || 0) + (c.duration || 0))
    )
  );

  // 🎬 HARD-GATE: a videó MAX 10 perc (short-video scope, SCOPES.md). A kliens is
  // figyelmeztet, de a biztonsági határ ITT van (autoritatív, nem bízunk a kliensben).
  if (totalDuration > MAX_RENDER_DURATION_SEC) {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    res.status(413).json({
      error: `A videó túl hosszú (${Math.round(totalDuration)} mp). A maximum ${MAX_RENDER_DURATION_SEC} mp (10 perc).`,
    });
    return;
  }

  // ☁️ FELHŐ-MÓD (csak a küszöbnél hosszabb videóra): média S3-ba, job a queue-ba —
  // külön worker(ek) renderelnek (skálázható, túléli az API-újraindítást).
  if (queueEnabled() && s3Enabled() && totalDuration > CLOUD_MIN_SEC) {
    const id = crypto.randomBytes(8).toString('hex');
    // 👤 A jobhoz a HÍVÓT is elmentjük: prod-ban a verifikált tokenből
    // (req.user.id), dev-ben (INSECURE_DEV) a kliens által küldött userId a
    // fallback. Ebből lesz a „Sor" nézet „a te renderelésed" jelölése + a kész
    // értesítés célja. A projekt-név és -hossz a listázáshoz/ETA-hoz kell.
    const uid = req.user?.id || (req.body.userId ? String(req.body.userId).trim() : '') || null;
    const projectName = (project.seo?.title || project.name || '').slice(0, 200) || null;
    // 📊 §2.2: a felhő-render havi perc-kvóta-gate (a hiteles tier a subscriptionből;
    // DB/service_role nélkül best-effort megenged → nincs regresszió). A könyvelés
    // (trackUsage) az enqueue UTÁN, hogy csak a ténylegesen sorba tett jobot számoljuk.
    const minutes = Math.max(1, Math.ceil(totalDuration / 60));
    (async () => {
      // 🖥️ FAIL-FAST: ne tegyünk sorba jobot, ha EGYETLEN render-worker sem él —
      // különben a job „waiting"-ben ülne, a kliens pedig 25%-on ragadna a
      // ~10 perces timeoutig (ez volt a „megosztás beragadt" tünet). Látható
      // hibát adunk, hogy a UI újrapróbálhasson (a média-feltöltés ELŐTT).
      const aliveWorkers = await listWorkers().catch(() => []);
      if (aliveWorkers.length === 0) {
        const wErr = new Error('Jelenleg nincs elérhető render-worker — indítsd el a render-workert, vagy próbáld újra pár perc múlva.');
        wErr.status = 503;
        throw wErr;
      }
      const rGate = await enforceQuota(uid, await userTier(uid), 'renderMinutes', minutes);
      if (!rGate.ok) {
        const qErr = new Error(`Elérted a havi render-perc kvótád (hátralévő: ${rGate.remaining} perc).`);
        qErr.status = 429;
        throw qErr;
      }
      const localToKey = new Map();
      for (const f of req.files ?? []) {
        const key = `${id}/in/${path.basename(f.path)}`;
        await uploadFile(key, f.path, f.mimetype);
        localToKey.set(f.path, `s3:${key}`);
      }
      for (const track of project.tracks ?? []) {
        for (const clip of track.clips ?? []) {
          if ('uri' in clip && localToKey.has(clip.uri)) {
            clip.uri = localToKey.get(clip.uri);
          }
          if (clip.kind === 'shape' && clip.imageUri && localToKey.has(clip.imageUri)) {
            clip.imageUri = localToKey.get(clip.imageUri);
          }
        }
      }
      await enqueueRender(id, {
        project,
        settings: settingsRaw,
        userId: uid,
        projectId: project.id ?? null,
        projectName,
        durationSec: Math.round(totalDuration),
        // 💠 §2.6: a kliens küldte szint CSAK a sor-prioritáshoz (nem biztonsági;
        // a render Pro-kapu mögött van). A tényleges tier-forrás a 4-tier bekötéskor (§2.4).
        tier: typeof req.body?.tier === 'string' ? req.body.tier : undefined,
      });
      // 📊 §2.2: sikeres sorba tétel után könyveljük a render-perceket (atomikus RPC).
      void trackUsage(uid, 'renderMinutes', minutes);
      // 📊 §2.2: CSAK a FELHŐ-render számít `exports`-nak (az on-device ingyen + vízjeles,
      // az nem jön ide). Egy felhő-export = +1 a havi exports-kvótába. (exportPolicy)
      void trackUsage(uid, 'exports', 1);
    })()
      .then(() => res.json({ id, mode: 'cloud' }))
      .catch((err) => {
        console.error('render enqueue hiba:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      });
    return;
  }

  const id = crypto.randomBytes(8).toString('hex');
  // 👤 A jobhoz a HÍVÓT is eltároljuk (BOLA-fix): a /render ...proOnly mögött van,
  // tehát req.user a verifikált tokenből jön; dev-ben (INSECURE_DEV) a body-fallback.
  // Ezt MINDEN állapot-frissítésnél megőrizzük (a jobs.set teljes objektumot cserél).
  const uid = req.user?.id || (INSECURE_DEV && req.body.userId ? String(req.body.userId).trim() : null) || null;
  // 🛑 megszakítás: a kliens ✕-je a /render/:id/cancel-en át abortálja ezt a
  // controllert → az ffmpeg azonnal leáll, a temp-mappa törlődik (nincs pazarlás).
  const controller = new AbortController();
  jobs.set(id, { state: 'processing', progress: 0, dir: workDir, userId: uid, abort: () => controller.abort() });
  res.json({ id });

  let settings = {};
  try {
    settings = JSON.parse(req.body.settings ?? '{}');
  } catch {
    // beállítások nélkül alapértékekkel megy
  }
  renderProject(
    project,
    workDir,
    (progress) => {
      const job = jobs.get(id);
      if (job && job.state === 'processing') {
        job.progress = progress;
      }
    },
    settings,
    controller.signal
  )
    .then((file) => {
      jobs.set(id, { state: 'done', file, dir: workDir, userId: uid });
    })
    .catch((err) => {
      if (controller.signal.aborted) {
        // megszakítva: nem hiba — a jobot lezárjuk és a temp-mappát takarítjuk
        jobs.set(id, { state: 'cancelled', dir: workDir, userId: uid });
        fs.rm(workDir, { recursive: true, force: true }, () => {});
      } else {
        console.error(`[${id}] render hiba:`, err.message);
        jobs.set(id, { state: 'error', error: err.message, dir: workDir, userId: uid });
      }
    });
});

// Vágási proxy (full-plan F2): a nagy felbontású videóból 720p-s, gyorsan
// dekódolható munka-példány készül — az app előnézete ezt játssza, a render
// az eredetivel fut. Ha a forrás eleve ≤1280 px, {skip:true} a válasz.
// Állapot/letöltés a közös job-végpontokon (/render/:id).
router.post('/proxy', requireAuth, rateLimit('render'), upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  execFile(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
     '-of', 'csv=s=x:p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, stdout) => {
      const dims = (stdout ?? '').trim().split('x').map((n) => parseInt(n, 10));
      if (probeErr || dims.length < 2 || !dims[0] || !dims[1]) {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        res.status(422).json({ error: 'Nincs videó-stream a fájlban.' });
        return;
      }
      // 🎚️ minőség-tier: a kliens a kért leghosszabb oldalt küldi (maxSide);
      // ha a forrás eleve ennél kisebb, nincs mit nyerni (skip)
      const maxSide = Math.min(
        2160,
        Math.max(320, Math.round(Number(req.body?.maxSide) || 1280))
      );
      if (Math.max(dims[0], dims[1]) <= maxSide) {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        res.json({ skip: true });
        return;
      }
      const id = crypto.randomBytes(8).toString('hex');
      // 🔒 B26: a proxy-job is a hívóé (eddig tulajdonos nélkül → ID birtokában bárki letölthette)
      const owner = req.user?.id || null;
      jobs.set(id, { state: 'processing', dir: workDir, userId: owner });
      res.json({ id });

      const out = path.join(workDir, 'proxy.mp4');
      execFile(
        'ffmpeg',
        ['-y', '-i', file.path,
         '-vf', `scale=w=${maxSide}:h=${maxSide}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out],
        { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
        (err) => {
          if (err) {
            console.error(`[${id}] proxy hiba:`, err.message);
            jobs.set(id, { state: 'error', error: 'A proxy-készítés nem sikerült.', dir: workDir, userId: owner });
          } else {
            jobs.set(id, { state: 'done', file: out, dir: workDir, userId: owner });
          }
        }
      );
    }
  );
});

// Collect Project: projekt + minden média egy zip-archívumban (átadás/archívum).
// A médiafájlok a media/ mappába kerülnek, a projekt uri-jai relatív útra
// íródnak át; állapot/letöltés a közös job-végpontokon (/render/:id).
router.post('/collect', requireAuth, rateLimit('render'), upload.any(), (req, res) => {
  let project;
  let uriMap;
  try {
    project = JSON.parse(req.body.project);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch {
    res.status(400).json({ error: 'Hibás project/uriMap JSON.' });
    return;
  }
  const workDir = req.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  const mediaDir = path.join(workDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  const relByUri = new Map();
  for (const [uri, field] of Object.entries(uriMap)) {
    const src = fieldToFile.get(field);
    if (!src) {
      continue;
    }
    const rel = path.join('media', path.basename(src));
    fs.renameSync(src, path.join(workDir, rel));
    relByUri.set(uri, rel);
  }
  for (const track of project.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.uri && relByUri.has(clip.uri)) {
        clip.uri = relByUri.get(clip.uri);
      }
    }
  }
  for (const asset of project.assets ?? []) {
    if (asset.uri && relByUri.has(asset.uri)) {
      asset.uri = relByUri.get(asset.uri);
    }
  }
  fs.writeFileSync(
    path.join(workDir, 'project.remix'),
    JSON.stringify(
      {
        format: 'vided-project',
        version: 1,
        exportedAt: new Date().toISOString(),
        collected: true,
        project,
      },
      null,
      2
    )
  );

  const id = crypto.randomBytes(8).toString('hex');
  // 🔒 B26: a collect-csomag (a teljes projekt médiástul) is a hívóé
  const owner = req.user?.id || null;
  jobs.set(id, { state: 'processing', dir: workDir, userId: owner });
  res.json({ id });

  const out = path.join(workDir, 'collect.zip');
  execFile(
    'zip',
    ['-r', '-q', out, 'project.remix', 'media'],
    { cwd: workDir, timeout: 10 * 60 * 1000 },
    (err) => {
      if (err) {
        console.error(`[${id}] collect hiba:`, err.message);
        jobs.set(id, { state: 'error', error: 'A csomagolás nem sikerült.', dir: workDir, userId: owner });
      } else {
        jobs.set(id, { state: 'done', file: out, dir: workDir, userId: owner });
      }
    }
  );
});

/**
 * 📋 A felhő-render SOR állapota a „Sor" (schedules) nézethez: ki mit renderel,
 * hányan vannak a hívó előtt, és kb. mennyi idő múlva kész. A pozíció és az ETA
 * a VALÓS feldolgozási sorrendből (active + waiting FIFO) és a worker-számból
 * (concurrency) számolódik. Az ETA egy job becsült ideje = videó-hossz ×
 * RENDER_ETA_FACTOR (a `veryfast` preset gyorsabb a valós időnél); a futó jobnál
 * a mért haladásból (progress + eltelt idő) pontosítunk. Csak a hívó saját
 * jobjai kapnak `mine:true` jelölést — a többi projekt neve is látszik (nyilvános
 * sor), de a cél a saját várakozási idő megmutatása.
 */
router.get('/render/queue', requireAuth, async (req, res) => {
  if (!queueEnabled()) {
    res.json({ enabled: false, concurrency: 0, jobs: [], mineAhead: null, mineEtaSec: null });
    return;
  }
  const uid = req.user?.id || (req.query.userId ? String(req.query.userId).trim() : '') || null;
  const FACTOR = Math.max(0.05, parseFloat(process.env.RENDER_ETA_FACTOR || '0.7'));
  const now = Date.now();
  try {
    const [snap, workers] = await Promise.all([listRenderJobs(), listWorkers().catch(() => [])]);
    const C = Math.max(1, snap.concurrency);
    // egy job becsült renderideje (mp) — 0 hossz esetén óvatos alapérték
    const estSec = (j) => Math.max(3, (j.durationSec > 0 ? j.durationSec : 20) * FACTOR);

    // melyik jobot melyik fázisban töri épp egy worker (download/render/upload)
    // — a beszédes „éppen tölti be / renderel / feltölti" szöveghez a kliensen.
    const phaseByJob = new Map();
    for (const w of workers) {
      for (const aj of w.activeJobs ?? []) {
        if (aj.jobId && aj.phaseKey) {
          phaseByJob.set(aj.jobId, aj.phaseKey);
        }
      }
    }

    // worker-slotok legkorábbi szabaddá válása (mp, most=0). A futó jobok
    // lefoglalják a slotokat a hátralévő idejükre; a maradék slot azonnal szabad.
    const active = snap.active;
    const slots = [];
    for (let i = 0; i < C; i++) {
      const a = active[i];
      if (!a) {
        slots.push(0);
        continue;
      }
      let remaining = estSec(a);
      if (a.progress > 0 && a.startedAt) {
        const elapsed = Math.max(0, (now - a.startedAt) / 1000);
        remaining = Math.max(2, elapsed * (100 / a.progress - 1));
      }
      slots.push(remaining);
    }
    slots.sort((x, y) => x - y);

    const out = [];
    let idx = 0; // 1-alapú pozíció az active+waiting sorban
    for (const a of active) {
      idx += 1;
      const remaining =
        a.progress > 0 && a.startedAt
          ? Math.max(2, ((now - a.startedAt) / 1000) * (100 / a.progress - 1))
          : estSec(a);
      out.push({
        ...view(a, uid),
        position: idx,
        etaSec: Math.round(remaining),
        startInSec: 0,
        phaseKey: phaseByJob.get(a.id) || 'render',
      });
    }
    // várakozók: a legkorábban szabad slotra kerülnek, FIFO-ban
    for (const w of snap.waiting) {
      idx += 1;
      slots.sort((x, y) => x - y);
      const startInSec = slots[0];
      const dur = estSec(w);
      slots[0] = startInSec + dur;
      out.push({
        ...view(w, uid),
        position: idx,
        startInSec: Math.round(startInSec),
        etaSec: Math.round(startInSec + dur),
      });
    }
    // lezárt jobok (nemrég) — pozíció/ETA nélkül, csak státusz + eredmény
    for (const c of snap.completed) {
      out.push({ ...view(c, uid), position: null, etaSec: null, startInSec: null });
    }
    for (const f of snap.failed) {
      out.push({ ...view(f, uid), position: null, etaSec: null, startInSec: null });
    }

    // a hívó legközelebbi (futó VAGY váró) jobja → „hányan vannak előtted" + ETA
    const mineNext = out.find((j) => j.mine && (j.state === 'active' || j.state === 'waiting'));
    res.json({
      enabled: true,
      concurrency: C,
      now,
      jobs: out,
      workers: workers.map((w) => workerView(w, uid)),
      mineAhead: mineNext ? mineNext.position - 1 : null,
      mineEtaSec: mineNext ? mineNext.etaSec : null,
    });
  } catch (err) {
    console.error('render-queue hiba:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** A schedules-sor egy jobjának kliens-mezői (userId-t NEM szivárogtatjuk ki). */
function view(j, uid) {
  return {
    id: j.id,
    state: j.state,
    progress: j.progress, // 0-100
    projectName: j.projectName,
    projectId: uid && j.userId === uid ? j.projectId : null, // deep-link csak a sajátra
    mine: Boolean(uid && j.userId && j.userId === uid),
    durationSec: j.durationSec,
    enqueuedAt: j.enqueuedAt,
    finishedAt: j.finishedAt,
    failedReason: j.state === 'failed' ? j.failedReason : null,
  };
}

/** Egy worker kliens-mezői a „Sor" nézethez (a nevet/leírást a kliens fordítja). */
function workerView(w, uid) {
  return {
    id: w.id,
    shortId: w.shortId ?? null,
    icon: w.icon || 'hardware-chip-outline',
    roleKey: w.roleKey || 'render',
    concurrency: w.concurrency ?? 1,
    status: w.status || 'idle', // 'idle' | 'busy'
    startedAt: w.startedAt ?? null,
    activeJobs: (w.activeJobs ?? []).map((aj) => ({
      jobId: aj.jobId,
      projectName: aj.projectName ?? null,
      phaseKey: aj.phaseKey || 'render',
      progress: typeof aj.progress === 'number' ? aj.progress : 0,
      mine: Boolean(uid && aj.userId && aj.userId === uid),
    })),
  };
}

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
router.get('/render/:id', renderJobAuth, async (req, res) => {
  // a rövid (lokális) render a jobs-mapben van; a hosszú (felhő) a queue-ban
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id, INSECURE_DEV)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    res.json({ state: job.state, error: job.error, progress: job.progress });
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch(() => null);
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
      });
      return;
    }
  }
  res.status(404).json({ error: 'Ismeretlen job.' });
});

router.get('/render/:id/file', renderJobAuth, async (req, res) => {
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
    const j = await getRenderJob(req.params.id).catch(() => null);
    if (j) {
      if (!canAccessRenderJob(j.userId, req.user?.id, INSECURE_DEV)) {
        denyRenderJob(req, res, j.userId);
        return;
      }
      if (j.state === 'completed' && j.returnvalue?.outKey) {
        const url = publicUrl(j.returnvalue.outKey);
        if (url) {
          res.redirect(url);
          return;
        }
      }
    }
  }
  res.status(404).json({ error: 'A render még nem készült el.' });
});

// 🛑 Render MEGSZAKÍTÁS (12 §2.3): a kliens ✕-je ide szól → a lokális (in-process)
// render ffmpeg-jét azonnal leállítjuk (AbortController), a sorban VÁRAKOZÓ jobot
// eltávolítjuk. Idempotens: ismeretlen/már-kész jobra is OK (a kliens csak jelez).
// BOLA: renderJobAuth + tulaj-egyezés (idegen jobot nem lehet megszakítani).
router.post('/render/:id/cancel', renderJobAuth, async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id, INSECURE_DEV)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    try {
      job.abort?.(); // → az ffmpeg SIGKILL + a temp-mappa törlése a render catch-ágában
    } catch {
      /* már leállt */
    }
    res.json({ ok: true, mode: 'local' });
    return;
  }
  if (queueEnabled()) {
    const r = await cancelRenderJob(req.params.id).catch(() => null);
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
});

module.exports = router;
