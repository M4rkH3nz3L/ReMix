// vided render worker — dev: `npm start` (port 8787).
// POST /render  (multipart: `project` JSON-mező + fájlok, fieldname = a manifest kulcsa)
//   a project JSON mellé `uriMap` mező jön: { "<clip uri>": "<file fieldname>" }
// GET  /render/:id           → { state, error? }
// GET  /render/:id/file      → a kész MP4
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const express = require('express');

const { aiAvailable, aiProvider } = require('./ai');
const { voiceChain } = require('./voicechain');
const { depthAvailable, ensureDepth } = require('./depth');
const { bgRemoveAvailable } = require('./bgremove');
const { faceAvailable } = require('./face');
const { stickers3dAvailable } = require('./sticker3d');
const { upscaleAvailable } = require('./upscale');
const { composeThumbnail } = require('./thumbs');
const { visionAvailable } = require('./vision');
const { listMediaLibrary } = require('./library');
const { renderProject, MAX_RENDER_DURATION_SEC } = require('./render');
const { ensureSfx, listLibrary } = require('./sfx');
const { ttsAvailable } = require('./tts');
const { ytAvailable } = require('./youtube');
const { queueEnabled, enqueueRender, getRenderJob, cancelRenderJob, listRenderJobs, renderConcurrency } = require('./queue');
const { listWorkers } = require('./workers-registry');
const { s3Enabled, uploadFile, publicUrl } = require('./s3store');
const { mediaStoreEnabled, uploadMedia: mediaStoreUpload, LOCAL_DIR: MEDIA_LOCAL_DIR, BUCKET: MEDIA_BUCKET } = require('./mediastore');
const { QuotaExceededError, quotaAvailable, usageFor, recordObject, wouldExceed } = require('./quota');
const userStorage = require('./userStorage');
const { notifyAvailable, adminClient } = require('./notify');
const { payoutsConfigured, sendPayout } = require('./payouts');
const { stemsConfigured, separateStems } = require('./stems');
const { callerId, corsAllowlist, requireAuth, INSECURE_DEV } = require('./auth');
// 🛡️ Security-réteg (devs/tasks/remix/): rate-limit (API4) + policy-leltár (API9).
const { rateLimit, DEFAULTS: RL_DEFAULTS } = require('./security/rateLimit');
const { authenticated, routeInventory } = require('./security/authorization');
const { mediaGuard } = require('./security/uploadPolicy');

// 🔴 LiveKit (élő videó) — token-mintázás a host/néző szerepéhez. A key/secret
// env-ből; lokális dev: `livekit-server --dev` → devkey/secret, ws://<host>:7880.
const { enforceQuota, trackUsage, userTier } = require('./usage');
const { canAccessRenderJob } = require('./security/renderAuth');
const { securityHeaders } = require('./security/securityHeaders');
const { securityEvent } = require('./security/auditLog');
const { eraseCooldownElapsed, storagePrefixes, listAllObjects } = require('./security/accountErase');
const {
  billingAvailable,
  activeTier,
} = require('./billing');
const { shouldWatermark } = require('./entitlements');
const { asTier } = require('./tiers');

const WHISPER_MODEL =
  process.env.WHISPER_MODEL || path.join(__dirname, 'models', 'ggml-base.bin');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

// 🔐 Megosztott HTTP-guardok + egységes hiba-handler (01-api-architecture §01.1/§01.3).
const { proOnly, paidOnly, renderJobAuth } = require('./lib/guards');
const { errorHandler } = require('./lib/httpError');

const app = express();
const jobs = new Map(); // id → { state: 'processing'|'done'|'error', file?, error?, dir }

// kérés-napló (diagnosztika): honnan jön a hívás és mire — a „nem érhető el”
// hibáknál ebből látszik, hogy a kérés egyáltalán megérkezik-e
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path} ← ${req.ip}`);
  next();
});

// 🔐 CORS: ALLOWLIST a korábbi `*` helyett. A `*` miatt a service_role-os
// végpontok bármely weboldalról hívhatók voltak. A natív app nem küld Origin-t,
// így az érintetlen; a böngészős dev-előnézethez a CORS_ORIGINS env kell.
app.use(corsAllowlist());

// 🧢 Security-fejlécek minden válaszra (nosniff / frame-options / HSTS / …) +
// az Express-ujjlenyomat (X-Powered-By) eltávolítása. (devs/tasks/remix/14)
app.disable('x-powered-by');
app.use(securityHeaders());

// 🗂️ LOKÁLIS média-tár statikus szolgálása (dev): a renderelt/feltöltött fájlok a
// böngészhető `server/media` mappából (MEDIA_LOCAL_DIR) — a feed innen játssza a
// videót. `express.static` támogatja a Range-kéréseket (videó-seek), így a natív
// `<video>` gond nélkül streameli. Auth NÉLKÜL: publikus tartalom (a `renders`
// bucket is public volt) — más útvonalak auth-védettek maradnak.
if (MEDIA_LOCAL_DIR) {
  fs.mkdirSync(MEDIA_LOCAL_DIR, { recursive: true });
  app.use('/m', express.static(MEDIA_LOCAL_DIR, { fallthrough: false, maxAge: '1h' }));
  console.log(`média-tár (lokális): ${MEDIA_LOCAL_DIR} → /m`);
}

// 🧱 Globális rate-limit (OWASP API4): a worker PUBLIKUS compute-API, limit nélkül
// DoS-/költség-attack felület. A `/m` statikus média-stream fölötte van (nincs
// blanket-limit a feed-lejátszásra); minden MÁS endpoint erre az IP-/user-kulcsú
// limitre ül. Dev-ben (ALLOW_INSECURE_DEV) és RL_DISABLED=1 esetén no-op. A drága
// osztályokra (ai/render) szigorúbb per-endpoint limit a terv következő lépése
// (devs/tasks/remix/03).
app.use(rateLimit('default'));

const { upload } = require('./lib/upload');

app.get('/health', async (_req, res) => {
  // a próbák PÁRHUZAMOSAN futnak (cache-selve is) — a /health a kliens-oldali
  // elemzések kapuja, sorosan az elfoglalt Ollama túllépné a kliens timeoutját
  const [ai, provider, vision, workerList] = await Promise.all([
    aiAvailable(),
    aiProvider(),
    visionAvailable(),
    listWorkers().catch(() => []),
  ]);
  res.json({
    ok: true,
    service: 'vided-render',
    // 🖥️ élő render-workerek száma (heartbeat, 20s TTL) — a kliens ebből tudja
    // előre, hogy a felhő-render (hosszú videó) ténylegesen feldolgozható-e
    workers: workerList.length,
    captions: fs.existsSync(WHISPER_MODEL),
    ai,
    aiProvider: provider,
    vision,
    depth: depthAvailable(),
    stickers3d: stickers3dAvailable(),
    bgremove: bgRemoveAvailable(),
    faces: faceAvailable(),
    upscale: upscaleAvailable(),
    tts: ttsAvailable(),
    youtube: ytAvailable(),
    notify: notifyAvailable(),
    billing: billingAvailable(),
    revenuecat: !!process.env.RC_WEBHOOK_AUTH,
    render: queueEnabled() && s3Enabled() ? 'cloud+local' : 'local',
    // feed-média tár: prod Supabase Storage (service_role) VAGY S3 — projekt-mappákba tölt
    storage: mediaStoreEnabled(),
    cloudRenderMinSec: parseInt(process.env.CLOUD_RENDER_MIN_SEC || '15', 10),
  });
});

// 📋 Route-/policy-leltár (OWASP API9): a security-réteg által regisztrált
// endpointok + a rate-limit osztály-konfig. Hitelesítés mögött (nem publikus).
// A per-route policy-cutover a devs/tasks/remix/01 szerint bővül majd.
app.get('/health/routes', authenticated(), (_req, res) => {
  res.json({
    ok: true,
    rateLimit: { enabled: !(process.env.RL_DISABLED === '1' || INSECURE_DEV), classes: RL_DEFAULTS },
    inventory: routeInventory(),
  });
});

// 🗑️ GDPR VÉGLEGES törlés (devs/tasks/remix/09). A soft-delete (deleted_at)
// visszaállítható; EZ a hard-erasure a cooldown letelte után: a user storage-
// médiája (a cascade által NEM fedett ~5%) + az auth-felhasználó (cascade a DB-re).
//
// ⚠️ DESTRUKTÍV → env-kapuzva (ALLOW_ACCOUNT_ERASE=1) KI van kapcsolva alapból;
// csak a SAJÁT fiókot törli (uid a verifikált tokenből), a cooldown letelte UTÁN.
// Éles bekapcsolás előtt eldobható fiókkal verifikálandó.
const ALLOW_ERASE = process.env.ALLOW_ACCOUNT_ERASE === '1';
const ERASE_BUCKET = process.env.MEDIA_BUCKET || 'renders';
// 🎚️ Hang-generáló route-ok (synth/drums/sampler/spektrogram) — domain-router (§01.1).
app.use(require('./routes/audioGen'));

app.post('/account/erase', express.json({ limit: '4kb' }), requireAuth, async (req, res) => {
  if (!ALLOW_ERASE) {
    res.status(403).json({ error: 'A végleges törlés ki van kapcsolva (ALLOW_ACCOUNT_ERASE=1 kell).' });
    return;
  }
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'Admin-kliens (service_role) nincs konfigurálva.' });
    return;
  }
  try {
    // 1) GATING: előbb soft-delete + a visszavonási idő letelte kötelező
    const { data: prof } = await sb
      .from('profiles')
      .select('deleted_at')
      .eq('id', uid)
      .maybeSingle();
    if (!eraseCooldownElapsed(prof?.deleted_at, Date.now())) {
      res.status(400).json({
        error: 'Előbb fiók-deaktiválás (soft-delete) + a visszavonási idő letelte szükséges.',
      });
      return;
    }
    // 2) STORAGE-média purge (best-effort) — a user projektjeinek objektumai
    let purged = 0;
    try {
      const { data: projs } = await sb
        .from('cloud_projects')
        .select('project_id')
        .eq('user_id', uid);
      const storage = sb.storage.from(ERASE_BUCKET);
      for (const prefix of storagePrefixes((projs || []).map((p) => p.project_id))) {
        const paths = await listAllObjects(storage, prefix);
        if (paths.length > 0) {
          await storage.remove(paths);
          purged += paths.length;
        }
      }
    } catch (e) {
      console.warn('[erase] storage-purge részleges:', e.message);
    }
    // 3) AUTH-felhasználó törlése → cascade a DB-ben (profiles/posts/…)
    const { error: delErr } = await sb.auth.admin.deleteUser(uid);
    if (delErr) {
      throw new Error(`auth-user törlés sikertelen: ${delErr.message}`);
    }
    securityEvent('account.erased', { actor: uid, result: 'ok', meta: { purgedObjects: purged } });
    res.json({ erased: true, purgedObjects: purged });
  } catch (e) {
    securityEvent('account.erase_failed', { actor: uid, result: 'error', meta: { error: e.message } });
    res.status(500).json({ error: e.message });
  }
});

// 🔗 Külső média route-ok (YouTube + TTS) — domain-router (§01.1).
app.use(require('./routes/externalMedia'));

// 🖼️🤖 Kép-AI route-ok — domain-router (§01.1).
app.use(require('./routes/imageAI'));

// 🤖 AI-worker route-ok (hooks/probe/translate/highlights/story/thumbheadlines/captionstudio/assist/autoedit) — domain-router (§01.1).
app.use(require('./routes/ai'));

// 🔔 Social route-ok (notify + invite) — domain-router (§01.1).
app.use(require('./routes/social'));

// 🔴 Live (LiveKit) route-ok — domain-router (§01.1).
app.use(require('./routes/live'));

// 💳 Billing / shop-kredit route-ok — domain-router (§01.1).
app.use(require('./routes/billing'));



// 🎬 headline ráégetése a kiválasztott borítóra (Chromium-raszter + overlay)
app.post('/thumbnails/compose', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const file = (req.files ?? [])[0];
  const headline = String(req.body.headline ?? '').trim();
  if (!file || !headline) {
    res.status(400).json({ error: 'Hiányzó kép vagy headline.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  composeThumbnail(file.path, headline, workDir)
    .then((out) => {
      const jpegBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ jpegBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('thumb-compose hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});



// 🎨 Color AI (P1 v1): egy kocka szín-statisztikái — Auto/Match Color alapja
/**
 * 🎙️ Voice Studio ELŐNÉZETI PROXY: a feltöltött hang/videó hangsávjára
 * ráfuttatja a RENDERREL AZONOS beszéd-javító láncot (voicechain.js), és
 * m4a-ként adja vissza. Így a szerkesztőben már hallható a javítás, nem csak
 * a kész exportban.
 *
 * A teljes hangot dolgozzuk fel (nem szeletet): így az előnézet bárhová
 * tekerhető, és a kliens fájlonként+beállításonként cache-eli.
 */
app.post('/voice/preview', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('audio'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const chain = voiceChain({
    voiceEnhance: req.body.voiceEnhance === 'true' || req.body.voiceEnhance === '1',
    deReverb: req.body.deReverb === 'true' || req.body.deReverb === '1',
  });
  if (!chain) {
    res.status(400).json({ error: 'Nincs bekapcsolt hang-javítás.' });
    return;
  }
  const out = path.join(req.workDir, 'voice.m4a');
  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-af', chain, '-c:a', 'aac', '-b:a', '160k', out],
    { timeout: 5 * 60 * 1000, maxBuffer: 1 << 24 },
    (err) => {
      if (err || !fs.existsSync(out)) {
        console.warn('voice-proxy hiba:', (err && err.message || '').slice(0, 200));
        res.status(422).json({ error: 'A hang feldolgozása nem sikerült.' });
        return;
      }
      res.sendFile(out);
    }
  );
});

// 🖼️ Kép-eszköz route-ok — domain-router (§01.1).
app.use(require('./routes/imageTools'));



// Auto-caption: médiafájl → hang kinyerése → Whisper → SRT.
// A kliens a kapott SRT-t a meglévő import-útvonalon dolgozza fel.
app.post('/captions', upload.any(), ...proOnly, (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    res.status(500).json({
      error: `Hiányzó Whisper-modell: ${WHISPER_MODEL} (töltsd le a huggingface ggerganov/whisper.cpp repóból).`,
    });
    return;
  }
  const workDir = req.workDir;
  const wav = path.join(workDir, 'audio16k.wav');
  const outBase = path.join(workDir, 'captions');
  const language = req.body.language || 'auto';
  // granularity=word: szavankénti cue-k (text-based editing, P0-3);
  // alapértelmezés: caption-méretű darabok (max ~40 karakter, szóhatáron)
  const maxLen = req.body.granularity === 'word' ? '1' : '40';

  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-ar', '16000', '-ac', '1', wav],
    { timeout: 5 * 60 * 1000 },
    (ffErr) => {
      if (ffErr) {
        res.status(422).json({ error: 'Nincs kinyerhető hang a fájlból.' });
        return;
      }
      execFile(
        'whisper-cli',
        [
          '-m', WHISPER_MODEL,
          '-f', wav,
          '-l', language,
          '-ml', maxLen,
          '-sow',
          '--output-srt',
          '--output-file', outBase,
          '--no-prints',
        ],
        { timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (wErr) => {
          if (wErr) {
            console.error('whisper hiba:', wErr.message);
            res.status(500).json({ error: 'A beszédfelismerés nem sikerült.' });
            return;
          }
          try {
            const srt = fs.readFileSync(`${outBase}.srt`, 'utf8');
            res.json({ srt });
          } catch {
            res.status(500).json({ error: 'A felirat-fájl nem jött létre.' });
          }
        }
      );
    }
  );
});

// Hullámforma az idővonalhoz: hangfájl → mono 8 kHz PCM → csúcslista.
// A kliens lemezre cache-eli, egy fájl csak egyszer jön fel.
app.post('/waveform', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('audio'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const RATE = 8000;
  const PEAKS_PER_SEC = 20;
  const MAX_SECONDS = 30 * 60;
  const pcm = path.join(workDir, 'wave.pcm');
  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-ac', '1', '-ar', String(RATE),
     '-t', String(MAX_SECONDS), '-f', 's16le', pcm],
    { timeout: 5 * 60 * 1000 },
    (err) => {
      if (err) {
        cleanup();
        res.status(422).json({ error: 'Nincs kinyerhető hang a fájlból.' });
        return;
      }
      try {
        const buf = fs.readFileSync(pcm);
        const samples = Math.floor(buf.length / 2);
        const bucket = Math.max(1, Math.floor(RATE / PEAKS_PER_SEC));
        const peaks = [];
        let top = 0.01;
        for (let i = 0; i < samples; i += bucket) {
          let max = 0;
          const end = Math.min(samples, i + bucket);
          for (let j = i; j < end; j++) {
            const v = Math.abs(buf.readInt16LE(j * 2));
            if (v > max) {
              max = v;
            }
          }
          const p = max / 32768;
          peaks.push(p);
          if (p > top) {
            top = p;
          }
        }
        cleanup();
        res.json({
          duration: samples / RATE,
          peaksPerSecond: PEAKS_PER_SEC,
          // a leghangosabb ponthoz normalizálva, 2 tizedesre kerekítve
          peaks: peaks.map((p) => Math.round((p / top) * 100) / 100),
        });
      } catch {
        cleanup();
        res.status(500).json({ error: 'A hullámforma-számítás nem sikerült.' });
      }
    }
  );
});

// 🎞️ Média-feltöltés (renderelt videó / borító) → publikus Storage-URL. A kliens
// a renderelt fájlt küldi (multipart), a feed ezt a URL-t játssza (cross-device).
app.post('/media/upload', upload.any(), requireAuth, async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  // 👤 a hívó a VERIFIKÁLT tokenből (dev-ben body.userId fallback) — ő terhelődik
  const uid = callerId(req, req.body?.userId);
  const bytes = Number(f.size || 0);
  const extRaw = path.extname(f.originalname || '') || `.${(f.mimetype || '').split('/')[1] || 'bin'}`;
  const ext = extRaw.replace(/[^.\w]/g, '');
  // a KÉRÉSBŐL épített worker-origin (LAN-on is stimmel; a lokális-disk URL-hez is)
  const publicBase = `${req.protocol}://${req.get('host')}`;
  try {
    // 🎯 AKTÍV TÁRHELY-CÉL: ha a user KÜLSŐ forrást jelölt ki, ODA mentünk (a saját
    // felhőjébe) — nem a MI (kvótás) tárhelyünkre, és a MI tárhely-konfig sem kell.
    // A visszaadott URL a proxyzott, VISSZAOLVASHATÓ út (a capability-token viszi a
    // jogosultságot bearer nélkül — a lejátszó/letöltő ezt hívja később is).
    let target = null;
    if (uid) {
      try {
        target = await userStorage.getDefaultTarget(uid);
      } catch {
        target = null;
      }
    }
    if (target) {
      const filename = `${crypto.randomUUID()}${ext}`;
      const { path: extPath, token } = await userStorage.uploadToSource(
        uid,
        target,
        f.path,
        filename,
        f.mimetype
      );
      const url = `${publicBase}/storage/${encodeURIComponent(target)}/file?path=${encodeURIComponent(
        extPath
      )}&it=${encodeURIComponent(token)}`;
      res.json({ url, key: extPath, size: bytes, target });
      return;
    }

    // ── ReMix-tárhely (alap): a MI tárolónkba + KVÓTA ──
    if (!mediaStoreEnabled()) {
      res.status(503).json({ error: 'storage nincs konfigurálva (SUPABASE service_role vagy S3_* env)' });
      return;
    }
    if (uid && quotaAvailable()) {
      const { exceeded, usage } = await wouldExceed(uid, bytes);
      if (exceeded) {
        res.status(507).json({ error: 'quota_exceeded', usage });
        return;
      }
    }
    // 📁 PROJEKT-rendezett kulcs: <projectId>/<kind>/<uuid>.<ext> (projekt nélkül <kind>/…)
    const kind = String(req.body?.kind || 'media').replace(/[^a-z]/gi, '').slice(0, 20) || 'media';
    const projectId = String(req.body?.projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
    const file = `${crypto.randomUUID()}${ext}`;
    const key = projectId ? `${projectId}/${kind}/${file}` : `${kind}/${file}`;
    const url = await mediaStoreUpload(key, f.path, f.mimetype, publicBase);
    // 🗄️ felvétel a bájt-naplóba (atomikus kvóta-ellenőrzéssel — verseny-biztos)
    if (uid && quotaAvailable()) {
      await recordObject(uid, {
        projectId: projectId || null,
        bucket: MEDIA_BUCKET,
        key,
        bytes,
        source: 'server',
      });
    }
    res.json({ url, key, size: bytes });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(507).json({ error: 'quota_exceeded', usage: err.usage });
      return;
    }
    console.error('Media upload hiba:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
  }
});

// 🎚️ Hang-analízis (AUDIO-MASTER Analyze): egy feltöltött hangon az ffmpeg
// `loudnorm` MÉRŐ-menete (print_format=json) → Integrated LUFS / True Peak / LRA,
// + egy `showspectrumpic` spektrum-kép (best-effort, a média-tárba).
app.post('/audio/analyze', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('audio'), async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  const measure = () =>
    new Promise((resolve) => {
      execFile(
        'ffmpeg',
        ['-hide_banner', '-nostats', '-i', f.path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
        { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
        (_e, _o, stderr) => resolve(/\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(stderr || '')?.[0] ?? null)
      );
    });
  try {
    const raw = await measure();
    if (!raw) {
      res.status(500).json({ error: 'Az analízis nem sikerült.' });
      return;
    }
    const j = JSON.parse(raw);
    const out = { lufs: Number(j.input_i), truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
    // 📊 zaj-alap + dinamika-tartomány (astats) — best-effort
    try {
      const st2 = await new Promise((resolve) =>
        execFile(
          'ffmpeg',
          ['-hide_banner', '-nostats', '-i', f.path, '-af', 'astats=metadata=1', '-f', 'null', '-'],
          { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
          (_e, _o, se) => resolve(se || '')
        )
      );
      const nf = /Noise floor dB:\s*(-?[\d.]+)/.exec(st2);
      const dr = /Dynamic range:\s*([\d.]+)/.exec(st2);
      if (nf) {
        out.noise = Number(nf[1]);
      }
      if (dr) {
        out.dynamicRange = Number(dr[1]);
      }
    } catch {
      // az astats opcionális
    }
    // 🎨 spektrum-kép (opcionális): showspectrumpic → média-tár
    if (mediaStoreEnabled()) {
      try {
        const specPath = `${f.path}.png`;
        await new Promise((resolve, reject) =>
          execFile(
            'ffmpeg',
            ['-y', '-i', f.path, '-lavfi', 'showspectrumpic=s=600x220:legend=0', specPath],
            { timeout: 60000 },
            (e) => (e ? reject(e) : resolve())
          )
        );
        const publicBase = `${req.protocol}://${req.get('host')}`;
        out.spectrum = await mediaStoreUpload(`analyze/${crypto.randomUUID()}.png`, specPath, 'image/png', publicBase);
        try {
          fs.unlinkSync(specPath);
        } catch {
          // takarítás best-effort
        }
      } catch {
        // a spektrum opcionális — a mérés attól még megy
      }
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
  }
});

// 🎚️ Stem-szeparáció (AI audio, Phase D) — Pro + Demucs (env-kapuzva). A feltöltött
// hangot vocals/drums/bass/other WAV-okra bontja, feltölti a média-tárba, és
// visszaadja a stemek URL-jeit. A kliens ezekből ÚJ hangklipeket rak a sávokra.
app.post('/audio/stems', upload.any(), ...proOnly, async (req, res) => {
  if (!stemsConfigured()) {
    res.status(503).json({ error: 'A stem-szeparáció nincs konfigurálva (Demucs).' });
    return;
  }
  if (!mediaStoreEnabled()) {
    res.status(503).json({ error: 'storage nincs konfigurálva (SUPABASE service_role vagy S3_* env)' });
    return;
  }
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-stems-'));
  const publicBase = `${req.protocol}://${req.get('host')}`;
  try {
    const stems = await separateStems(f.path, workDir);
    const out = [];
    for (const s of stems) {
      const key = `stems/${crypto.randomUUID()}-${s.name}.wav`;
      const url = await mediaStoreUpload(key, s.path, 'audio/wav', publicBase);
      out.push({ name: s.name, url });
    }
    res.json({ stems: out });
  } catch (err) {
    console.error('Stem-szeparáció hiba:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // takarítás best-effort
    }
  }
});

// 🗄️ Tárhely-használat/kvóta (profil-kijelzés): a MI tárhelyünkön fekvő bájtok +
// az alap (tier) és a koinos bónusz. A hívó a VERIFIKÁLT tokenből.
app.get('/storage/usage', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  if (!quotaAvailable()) {
    res.status(503).json({ error: 'A tárhely-elszámolás nincs konfigurálva (service_role).' });
    return;
  }
  try {
    res.json({ usage: await usageFor(uid) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 💸 Kifizetés: koin → pénz (3 Ft/koin). A koin-levonást + a 'pending' payout-sort
// az atomikus request_payout_for RPC végzi, majd megpróbáljuk a provider-utalást
// (PayPal). Provider nélkül a kérelem 'pending' marad (manuális teljesítés). A
// hívó a VERIFIKÁLT tokenből — mást nem lehet a nevében kifizettetni.
app.post('/wallet/payout', requireAuth, express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Hiányzó felhasználó.' });
    return;
  }
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'A kifizetés nincs konfigurálva (service_role).' });
    return;
  }
  const coins = Math.trunc(Number(req.body?.coins || 0));
  if (!Number.isFinite(coins) || coins <= 0) {
    res.status(400).json({ error: 'Érvénytelen koin-mennyiség.' });
    return;
  }
  try {
    const { data: acct } = await sb
      .from('payout_accounts')
      .select('provider, email')
      .eq('user_id', uid)
      .maybeSingle();
    if (!acct || !acct.email) {
      res.status(400).json({ error: 'no_payout_account' });
      return;
    }
    // levon + 'pending' payout-sor (atomikus, szerver-hiteles)
    const { data: reqRow, error: rpcErr } = await sb.rpc('request_payout_for', {
      p_user: uid,
      p_coins: coins,
    });
    if (rpcErr) {
      if (/insufficient_credits/.test(rpcErr.message)) {
        res.status(400).json({ error: 'insufficient_credits' });
        return;
      }
      if (/below_min_payout/.test(rpcErr.message)) {
        res.status(400).json({ error: 'below_min_payout' });
        return;
      }
      throw new Error(rpcErr.message);
    }
    if (!payoutsConfigured()) {
      // provider nincs beállítva → a kérelem 'pending' marad (manuális teljesítés)
      res.json({ status: 'pending', ...reqRow });
      return;
    }
    try {
      const ref = await sendPayout(acct, reqRow.amount_huf, `ReMix payout ${reqRow.request_id}`);
      await sb.rpc('resolve_payout', {
        p_request: reqRow.request_id,
        p_status: 'paid',
        p_provider_ref: ref,
      });
      res.json({ status: 'paid', provider_ref: ref, ...reqRow });
    } catch (perr) {
      // provider-hiba → koin-visszatérítés a resolve_payout-ban
      await sb.rpc('resolve_payout', {
        p_request: reqRow.request_id,
        p_status: 'failed',
        p_provider_ref: null,
      });
      res.status(502).json({ error: `payout_failed: ${perr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/render', upload.any(), ...paidOnly, (req, res) => {
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

// 🎛️ Editor-analízis route-ok — domain-router (§01.1).
app.use(require('./routes/analysis'));

// Vágási proxy (full-plan F2): a nagy felbontású videóból 720p-s, gyorsan
// dekódolható munka-példány készül — az app előnézete ezt játssza, a render
// az eredetivel fut. Ha a forrás eleve ≤1280 px, {skip:true} a válasz.
// Állapot/letöltés a közös job-végpontokon (/render/:id).
app.post('/proxy', upload.any(), requireAuth, rateLimit('render'), (req, res) => {
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
      jobs.set(id, { state: 'processing', dir: workDir });
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
            jobs.set(id, { state: 'error', error: 'A proxy-készítés nem sikerült.', dir: workDir });
          } else {
            jobs.set(id, { state: 'done', file: out, dir: workDir });
          }
        }
      );
    }
  );
});

// Collect Project: projekt + minden média egy zip-archívumban (átadás/archívum).
// A médiafájlok a media/ mappába kerülnek, a projekt uri-jai relatív útra
// íródnak át; állapot/letöltés a közös job-végpontokon (/render/:id).
app.post('/collect', upload.any(), requireAuth, rateLimit('render'), (req, res) => {
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
  jobs.set(id, { state: 'processing', dir: workDir });
  res.json({ id });

  const out = path.join(workDir, 'collect.zip');
  execFile(
    'zip',
    ['-r', '-q', out, 'project.remix', 'media'],
    { cwd: workDir, timeout: 10 * 60 * 1000 },
    (err) => {
      if (err) {
        console.error(`[${id}] collect hiba:`, err.message);
        jobs.set(id, { state: 'error', error: 'A csomagolás nem sikerült.', dir: workDir });
      } else {
        jobs.set(id, { state: 'done', file: out, dir: workDir });
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
app.get('/render/queue', requireAuth, async (req, res) => {
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
// szivárogtatjuk). Tulajdonos-nélküli (proxy/collect) jobnál nincs korlát.
app.get('/render/:id', renderJobAuth, async (req, res) => {
  // a rövid (lokális) render a jobs-mapben van; a hosszú (felhő) a queue-ban
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id)) {
      denyRenderJob(req, res, job.userId);
      return;
    }
    res.json({ state: job.state, error: job.error, progress: job.progress });
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch(() => null);
    if (j) {
      if (!canAccessRenderJob(j.userId, req.user?.id)) {
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

app.get('/render/:id/file', renderJobAuth, async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id)) {
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
      if (!canAccessRenderJob(j.userId, req.user?.id)) {
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
app.post('/render/:id/cancel', renderJobAuth, async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (!canAccessRenderJob(job.userId, req.user?.id)) {
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
      if (!canAccessRenderJob(r.userId, req.user?.id)) {
        denyRenderJob(req, res, r.userId);
        return;
      }
      res.json({ ok: true, mode: 'queue', removed: r.removed, active: r.active });
      return;
    }
  }
  res.json({ ok: true, mode: 'none' });
});

// 🔌 Storage-gateway: a user SAJÁT külső forrásai (Google Drive / Dropbox / WebDAV
// / S3) a `user_storage_providers` táblából + a legacy globális admin-config
// (storage.config.json). A hitelesítés (OAuth token/kulcs) a WORKEREN marad — a
// kliens sosem látja, csak a proxyzott végpontokat. Minden route requireAuth.
// 🗄️ Külső tárhely-providerek (Drive/Dropbox/WebDAV/S3) — domain-router (§01.1).
app.use(require('./routes/storage'));

// médiatár: a server/library mappa videó/kép/hang fájljai (app „Tár" panel)
let mediaLibCache = null;
app.get('/library', (_req, res) => {
  (mediaLibCache ? Promise.resolve(mediaLibCache) : listMediaLibrary())
    .then((items) => {
      mediaLibCache = items;
      res.json({
        entries: items.map(({ id, name, kind, duration, size }) => ({
          id,
          name,
          kind,
          duration,
          size,
          url: `/library/${encodeURIComponent(id)}/file`,
        })),
      });
    })
    .catch(() => res.status(500).json({ error: 'A médiatár nem olvasható.' }));
});

app.get('/library/:id/file', (req, res) => {
  (mediaLibCache ? Promise.resolve(mediaLibCache) : listMediaLibrary())
    .then((items) => {
      mediaLibCache = items;
      const item = items.find((t) => t.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Ismeretlen médiafájl.' });
        return;
      }
      res.sendFile(item.file);
    })
    .catch(() => res.status(500).json({ error: 'A médiatár nem olvasható.' }));
});

// hang-könyvtár: generált SFX-ek + a server/music mappa fájljai
let libraryCache = null;
app.get('/music', (_req, res) => {
  (libraryCache ? Promise.resolve(libraryCache) : listLibrary())
    .then((items) => {
      libraryCache = items;
      res.json({
        tracks: items.map(({ id, name, kind, duration, bpm, energy }) => ({
          id,
          name,
          kind,
          duration,
          // egységes metaadat minden trackre (videóhoz-illesztéshez)
          bpm: bpm ?? 0,
          energy: typeof energy === 'number' ? energy : 0.5,
          url: `/music/${encodeURIComponent(id)}/file`,
        })),
      });
    })
    .catch(() => res.status(500).json({ error: 'A könyvtár nem olvasható.' }));
});

app.get('/music/:id/file', (req, res) => {
  (libraryCache ? Promise.resolve(libraryCache) : listLibrary())
    .then((items) => {
      libraryCache = items;
      const item = items.find((t) => t.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Ismeretlen hang.' });
        return;
      }
      res.sendFile(item.file);
    })
    .catch(() => res.status(500).json({ error: 'A könyvtár nem olvasható.' }));
});

// 🧯 Egységes hiba-handler a lánc VÉGÉN (01-api-architecture §01.3): a route-okból
// dobott HttpError / next(err) egységes JSON-alakra ({ error, code?, issues? }).
app.use(errorHandler);

// 🚀 A szerver CSAK közvetlen indításkor figyel + futtat háttér-ciklusokat
// (node index.js). Teszt-importkor (require('./index')) NEM fut a listen/interval —
// így a route-réteg integrációs teszttel vizsgálható (01-api-architecture §01.1).
if (require.main === module) {
  // a music/library mappa változhat futás közben — a cache 30 mp-enként frissül
  setInterval(() => {
    libraryCache = null;
    mediaLibCache = null;
  }, 30 * 1000).unref();

  // 💰 F3: a túl hosszú élő-adásokat (egress) periodikusan auto-stop (költségkontroll).
  // Csak akkor fut valóban, ha az egress + service_role konfigurált (egressConfigured).
  const { sweepStaleEgress } = require('./liveEgress');
  setInterval(() => {
    sweepStaleEgress().catch(() => {});
  }, 5 * 60 * 1000).unref();

  app.listen(PORT, () => {
    console.log(`vided render worker: http://localhost:${PORT}`);
    ensureSfx()
      .then(() => console.log('SFX-könyvtár kész (server/assets/sfx)'))
      .catch(() => {});
  });
}

module.exports = app;
