const { bindAudioMix } = require('../../lib/audioMix');
const { logCaught } = require('../../lib/caught');
// 🎬 POST /render — a projekt-render beküldése: rövid videó lokálisan (in-process), hosszú a felhő-sorba.
// A kezelők SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/render.js-ben.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { INSECURE_DEV } = require('../../auth');
const { renderProject, maxRenderSecFor } = require('../../render');
const { queueEnabled, enqueueRender } = require('../../queue');
const { listWorkers } = require('../../workers-registry');
const { s3Enabled, uploadFile } = require('../../s3store');
const { trackUsage, userTier, enforceQuota } = require('../../usage');
const { jobs } = require('./jobStore');

exports.renderSubmitHandler = (req, res) => {
  let project;
  let uriMap;
  try {
    project = JSON.parse(req.body.project);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch (caught) {
    logCaught('routes/render.js', caught);
    res.status(400).json({ error: 'Hibás project/uriMap JSON.' });
    return;
  }
  const workDir = req.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));

  // a klip-uri-k átírása a feltöltött fájlokra
  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  // 🎧 „azt kapod, amit hallasz”: a telefon kész keveréke (előnézet = export) — csak feltöltött fájl
  bindAudioMix(project, fieldToFile);
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
  } catch (caught) {
    logCaught('routes/render.js', caught);
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
  // 🎧 S18: a csak-hang export (audioFormat) a hang plafonját kapja (podcast, album: órák)
  const audioOnly = !!settingsRaw.audioFormat;
  const maxSec = maxRenderSecFor(settingsRaw);
  if (totalDuration > maxSec) {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    res.status(413).json({
      error: audioOnly
        ? `A hang túl hosszú (${Math.round(totalDuration)} mp). A maximum ${maxSec} mp (${Math.round(maxSec / 3600)} óra).`
        : `A videó túl hosszú (${Math.round(totalDuration)} mp). A maximum ${maxSec} mp (10 perc).`,
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
      const aliveWorkers = await listWorkers().catch((caught) => { logCaught('routes/render.js', caught); return []; });
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
      if (project.audioMixUri && localToKey.has(project.audioMixUri)) {
        project.audioMixUri = localToKey.get(project.audioMixUri);
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
      logCaught('routes/render.js', err);
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
  } catch (caught) {
    logCaught('routes/render.js', caught);
    // beállítások nélkül alapértékekkel megy
  }
  const report = {}; // 🛑 az effekt-szintű visszaesések (a kliens jelzi)
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
    controller.signal,
    report
  )
    .then((file) => {
      jobs.set(id, { state: 'done', file, dir: workDir, userId: uid, degraded: report.degraded || [] });
    })
    .catch((err) => {
    logCaught('routes/render.js', err);
      if (controller.signal.aborted) {
        // megszakítva: nem hiba — a jobot lezárjuk és a temp-mappát takarítjuk
        jobs.set(id, { state: 'cancelled', dir: workDir, userId: uid });
        fs.rm(workDir, { recursive: true, force: true }, () => {});
      } else {
        console.error(`[${id}] render hiba:`, err.message);
        jobs.set(id, { state: 'error', error: err.message, dir: workDir, userId: uid });
      }
    });
};
