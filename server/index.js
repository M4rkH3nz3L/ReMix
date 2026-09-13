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
const multer = require('multer');

const { aiAvailable, aiProvider, probeProvider, runAssistant, runAutoEdit, runCaptionStudio, runHighlights, runHookGenerator, runStoryEngine, runThumbHeadlines, runTranslateCaptions, sanitizeAiConfig } = require('./ai');
const { analyzeBeats } = require('./beats');
const { voiceChain } = require('./voicechain');
const { renderImageDoc } = require('./imagedoc');
const { computeFocusAssets, computeParallaxAssets, depthAvailable, depthLayerDir, ensureDepth } = require('./depth');
const { bgRemoveAvailable, bgRemoveDir, computeCutout } = require('./bgremove');
const { colorStats, pixelColor, exportLut, scopeImage } = require('./color');
const { detectFaces, faceAvailable } = require('./face');
const { listStickers3d, renderSticker3d, stickers3dAvailable } = require('./sticker3d');
const { listSkies, replaceSky } = require('./sky');
const { upscaleAvailable, upscaleImage } = require('./upscale');
const { trackMedia } = require('./track');
const { analyzeReframe } = require('./reframe');
const { composeThumbnail, pickThumbnails, scoreShots } = require('./thumbs');
const { indexFrames, queryScores, visionAvailable } = require('./vision');
const { listMediaLibrary } = require('./library');
const { renderProject } = require('./render');
const { ensureSfx, listLibrary } = require('./sfx');
const { ttsAvailable, synthesize, ttsFile, listVoices } = require('./tts');
const { ytAvailable, importMedia, youtubeFile } = require('./youtube');
const { queueEnabled, enqueueRender, getRenderJob } = require('./queue');
const { s3Enabled, uploadFile, publicUrl } = require('./s3store');
const { notifyAvailable, sendNotification, inviteMember } = require('./notify');
const {
  billingAvailable,
  activatePro,
  deactivatePro,
  grantCredits,
  handleRevenueCatEvent,
} = require('./billing');

const WHISPER_MODEL =
  process.env.WHISPER_MODEL || path.join(__dirname, 'models', 'ggml-base.bin');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

const app = express();
const jobs = new Map(); // id → { state: 'processing'|'done'|'error', file?, error?, dir }

// kérés-napló (diagnosztika): honnan jön a hívás és mire — a „nem érhető el”
// hibáknál ebből látszik, hogy a kérés egyáltalán megérkezik-e
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path} ← ${req.ip}`);
  next();
});

// a webes dev-előnézet (8081) másik originről hívja a workert
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      if (!req.workDir) {
        req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
      }
      cb(null, req.workDir);
    },
    filename: (_req, file, cb) => {
      // a fieldname a kulcs; a kiterjesztést megőrizzük az ffmpeg formátum-döntéséhez
      cb(null, `${file.fieldname}${path.extname(file.originalname) || ''}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

app.get('/health', async (_req, res) => {
  // a próbák PÁRHUZAMOSAN futnak (cache-selve is) — a /health a kliens-oldali
  // elemzések kapuja, sorosan az elfoglalt Ollama túllépné a kliens timeoutját
  const [ai, provider, vision] = await Promise.all([
    aiAvailable(),
    aiProvider(),
    visionAvailable(),
  ]);
  res.json({
    ok: true,
    service: 'vided-render',
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
    cloudRenderMinSec: parseInt(process.env.CLOUD_RENDER_MIN_SEC || '15', 10),
  });
});

// 🔗 URL-import (YouTube stb.): teljes videó / csak hang / egy képkocka
app.post('/youtube', express.json({ limit: '8kb' }), async (req, res) => {
  if (!ytAvailable()) {
    res.status(501).json({ error: 'A yt-dlp nincs telepítve a workeren (brew install yt-dlp).' });
    return;
  }
  try {
    const { url, kind, atSec } = req.body || {};
    res.json(await importMedia(url, kind, atSec));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/youtube/:id/:name', (req, res) => {
  const file = youtubeFile(req.params.id, req.params.name);
  if (!file || !fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

// 🗣️ TTS (szöveg → beszéd): elérhető hangok, generálás, letöltés
app.get('/tts/voices', async (_req, res) => {
  res.json({ available: ttsAvailable(), voices: await listVoices() });
});
app.post('/tts', express.json({ limit: '256kb' }), async (req, res) => {
  if (!ttsAvailable()) {
    res.status(501).json({ error: 'A TTS csak macOS dev-workeren érhető el.' });
    return;
  }
  try {
    const { text, voice } = req.body || {};
    res.json(await synthesize(text, voice));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/tts/:id/:name', (req, res) => {
  const file = ttsFile(req.params.id, req.params.name);
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

// 🙂 Arc-detektálás egy képkockán (UltraFace, CPU) — a dobozok a megadott
// vászon-arányra normalizálva jönnek (a tracker/pozicionálás nyelvén).
app.post('/faces', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  detectFaces(file.path, {
    atSec: num(req.body.atSec, 0),
    aspectW: num(req.body.aspectW, 9),
    aspectH: num(req.body.aspectH, 16),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.error('faces hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🏆 Best-shot pontozás (P0-1): forrás-időpontok vizuális minősége az Auto Edithez
app.post('/shotscore', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  let times;
  try {
    times = JSON.parse(req.body.times ?? '[]');
  } catch {
    times = [];
  }
  if (!Array.isArray(times) || times.length === 0) {
    cleanup();
    res.status(400).json({ error: 'Hiányzó időpontok.' });
    return;
  }
  scoreShots(file.path, times.map(Number).filter((t) => Number.isFinite(t) && t >= 0))
    .then((shots) => {
      cleanup();
      res.json({ shots });
    })
    .catch((err) => {
      cleanup();
      console.error('shotscore hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🌅 Sky Replacement (CC V2): égbolt-csere presetekkel (mélység-alapú maszk)
app.get('/sky/presets', (_req, res) => {
  res.json({ presets: listSkies() });
});

app.post('/sky', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  const preset = String(req.body.preset ?? 'sunset');
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  ensureDepth(file.path)
    .then(({ dir, depthPng, w, h }) =>
      replaceSky(file.path, depthPng, preset, dir, { w, h })
    )
    .then(({ file: out, cached }) => {
      const pngBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ cached, pngBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('sky hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🔍 Upscale / Enhance (CC V2): fotó felnagyítása szuper-felbontással
app.post('/upscale', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const scale = parseInt(req.body.scale, 10) === 4 ? 4 : 2;
  upscaleImage(file.path, { scale, workDir: req.workDir })
    .then(({ file: out, width, height, cached }) => {
      const pngBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ width, height, cached, pngBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('upscale hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🪝 Hook Generator (P2): téma → 6 különböző stílusú nyitómondat
app.post('/ai/hooks', express.json({ limit: '256kb' }), (req, res) => {
  const { summary, aiConfig } = req.body ?? {};
  if (!summary || typeof summary !== 'string') {
    res.status(400).json({ error: 'Hiányzó összefoglaló.' });
    return;
  }
  runHookGenerator(summary.slice(0, 2000), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Hook hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🟢 Provider-health: elérhető-e a modell végpontja (a karakter-picker bogyójához)
app.post('/ai/probe', express.json({ limit: '64kb' }), (req, res) => {
  const cfg = sanitizeAiConfig(req.body?.aiConfig);
  if (!cfg) {
    res.json({ ok: false });
    return;
  }
  probeProvider(cfg)
    .then((ok) => res.json({ ok }))
    .catch(() => res.json({ ok: false }));
});

// 🔔 Értesítés-küldés (service_role): SELF + CROSS-USER (team-working). Beszúr a
// notifications-be (realtime kézbesíti) + best-effort Expo push a push_tokenekre.
// ⚠️ PROD: JWT-verifikáció + hívó-jogosultság (ki kinek küldhet) mögé kell tenni,
//    lásd TODO.md „Biztonság" (a worker ma nem hitelesít).
app.post('/notify', express.json({ limit: '64kb' }), (req, res) => {
  if (!notifyAvailable()) {
    res.status(503).json({ error: 'notify nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  sendNotification(req.body ?? {})
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Notify hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 👥 Meghívás egy projektbe (service_role): e-mail → tag hozzáadás VAGY pending
// invite + „meghívtak" értesítés. A névfeloldás (auth.users e-mail) miatt kell a
// worker (a kliens az RLS-en nem lát más e-mailt). ⚠️ PROD: JWT + „ki hívhat meg"
// jogosultság (csak a tulaj) mögé — lásd TODO.md Biztonság.
app.post('/invite', express.json({ limit: '32kb' }), (req, res) => {
  if (!notifyAvailable()) {
    res.status(503).json({ error: 'invite nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  inviteMember(req.body ?? {})
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Invite hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 💳 Pro aktiválás — MANUÁLIS / DEV / promó út (a valós pénz a RevenueCat
// webhookon jön, lásd lentebb). service_role-lal ír a subscriptions-be.
// ⚠️ PROD: JWT-verifikáció + a valós fizetés IGAZOLÁSA nélkül NE aktiváljon
//    (ez az endpoint prod-ban csak admin/promó lehet) — lásd TODO.md Fizetés.
app.post('/billing/activate', express.json({ limit: '16kb' }), (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  const { userId, days } = req.body ?? {};
  activatePro(userId, { days: Number.isFinite(days) ? days : 30, source: 'manual' })
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Billing activate hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 🪙 Shop kredit feltöltés — DEV/manuális (a valós top-up a RevenueCat consumable
// webhookon, `credits_<n>` product). ⚠️ PROD: admin-only / valós fizetés-igazolás.
app.post('/shop/credits/grant', express.json({ limit: '16kb' }), (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva' });
    return;
  }
  const { userId, amount } = req.body ?? {};
  grantCredits(userId, Number.isFinite(amount) ? amount : 100, 'topup', 'manual')
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Credit grant hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 💳 Pro visszavonás — DEV/manuális (teszteléshez). ⚠️ PROD: admin-only.
app.post('/billing/deactivate', express.json({ limit: '16kb' }), (req, res) => {
  if (!billingAvailable()) {
    res.status(503).json({ error: 'billing nincs konfigurálva' });
    return;
  }
  deactivatePro((req.body ?? {}).userId, { source: 'manual', status: 'canceled' })
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Billing deactivate hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 💳 RevenueCat webhook — a VALÓS pénz-út (App Store / Play IAP). A RevenueCat
// egy általad megadott Authorization-fejlécet küld: RC_WEBHOOK_AUTH env-ből.
// Beállítva: az egyezést ellenőrizzük; enélkül 503 (nincs bekötve).
app.post('/billing/revenuecat', express.json({ limit: '256kb' }), (req, res) => {
  const secret = process.env.RC_WEBHOOK_AUTH;
  if (!secret || !billingAvailable()) {
    res.status(503).json({ error: 'RevenueCat webhook nincs konfigurálva (RC_WEBHOOK_AUTH / service_role)' });
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== secret && auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  handleRevenueCatEvent(req.body ?? {})
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('RevenueCat webhook hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

// 🌍 Felirat-fordítás (Phase 4.2): szegmensek + célnyelv → fordított szegmensek
app.post('/ai/translate', express.json({ limit: '512kb' }), (req, res) => {
  const { segments, lang, aiConfig } = req.body ?? {};
  if (!Array.isArray(segments) || segments.length === 0 || !lang) {
    res.status(400).json({ error: 'Hiányzó szegmensek vagy célnyelv.' });
    return;
  }
  runTranslateCaptions(segments.slice(0, 200), String(lang).slice(0, 40), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Translate hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎯 Highlights (Phase 3.3): long-form → több önálló short-jelölt (idő-ablak)
app.post('/ai/highlights', express.json({ limit: '512kb' }), (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runHighlights(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Highlights hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎬 Story Engine (Phase 1.1): jelek (hossz + átirat) → dramaturgiai fejezetek
app.post('/ai/story', express.json({ limit: '512kb' }), (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runStoryEngine(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Story hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎬 Thumbnail headline-javaslatok (CC V2): téma-összefoglaló → 3 rövid cím
app.post('/ai/thumbheadlines', express.json({ limit: '256kb' }), (req, res) => {
  const { summary, aiConfig } = req.body ?? {};
  if (!summary || typeof summary !== 'string') {
    res.status(400).json({ error: 'Hiányzó összefoglaló.' });
    return;
  }
  runThumbHeadlines(summary.slice(0, 2000), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('ThumbHeadline hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎬 headline ráégetése a kiválasztott borítóra (Chromium-raszter + overlay)
app.post('/thumbnails/compose', upload.any(), (req, res) => {
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

// ✨ Caption Studio (P1): kiemelt szavak + emoji a felirat-szegmensekhez
app.post('/ai/captionstudio', express.json({ limit: '1mb' }), (req, res) => {
  const { segments, aiConfig } = req.body ?? {};
  if (!Array.isArray(segments) || segments.length === 0) {
    res.status(400).json({ error: 'Hiányzó szegmensek.' });
    return;
  }
  runCaptionStudio(segments.slice(0, 60), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('CaptionStudio hiba:', err.message);
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
app.post('/voice/preview', upload.any(), (req, res) => {
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

/**
 * 🎨 Kép-dokumentum rasterizálása: réteg-fa (JSON) + a hivatkozott médiafájlok
 * → PNG. A formákat/feliratokat ugyanaz a generátor rajzolja, mint az
 * idővonalon, így a kép és a videó megjelenése garantáltan egyezik.
 */
app.post('/imagedoc', upload.any(), (req, res) => {
  let doc;
  let uriMap;
  try {
    doc = JSON.parse(req.body.doc);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch {
    res.status(400).json({ error: 'Hibás doc/uriMap JSON.' });
    return;
  }
  // a rétegek uri-jait a feltöltött fájlokra írjuk át (ugyanaz a minta, mint a
  // /render-nél); a nem feltöltött hivatkozás marad, a rasterizáló kihagyja
  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  for (const layer of doc.layers ?? []) {
    for (const key of ['uri', 'imageUri']) {
      const field = layer[key] ? uriMap[layer[key]] : null;
      const file = field ? fieldToFile.get(field) : null;
      if (file) {
        layer[key] = file;
      }
    }
  }
  const height = Math.max(240, Math.min(2160, Number(req.body.height) || 1280));
  renderImageDoc(doc, height, req.workDir)
    .then((file) => res.sendFile(file))
    .catch((err) => {
      console.warn('imagedoc hiba:', err.message.slice(0, 300));
      res.status(500).json({ error: err.message.slice(0, 300) });
    });
});

app.post('/color/stats', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  colorStats(file.path, Number.isFinite(atSec) ? atSec : 0)
    .then((stats) => {
      cleanup();
      res.json(stats);
    })
    .catch((err) => {
      cleanup();
      console.error('color-stats hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎨 Színpipetta: pixel-szín a médiakockán a (x,y) vászon-normalizált ponton
app.post('/color/pixel', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  const x = Number(req.body.x);
  const y = Number(req.body.y);
  pixelColor(file.path, Number.isFinite(atSec) ? atSec : 0, Number.isFinite(x) ? x : 0.5, Number.isFinite(y) ? y : 0.5)
    .then((r) => {
      cleanup();
      res.json(r);
    })
    .catch((err) => {
      cleanup();
      console.error('color-pixel hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎞️ LUT-export: a kliens elküldi a klip grade-jét (grade preset + adjust +
// curves + HSL), a worker egy identitás-rácsot átfuttat a szín-láncon és .cube
// 3D LUT-ot ad vissza. (Importált LUT-ot itt nem sütünk be — az a kliensen már
// megvan; a vignettát kihagyjuk, mert pozíciófüggő.)
app.post('/color/lut-export', express.json({ limit: '256kb' }), (req, res) => {
  const clip = {
    grade: typeof req.body.grade === 'string' ? req.body.grade : undefined,
    strength: Number.isFinite(Number(req.body.strength)) ? Number(req.body.strength) : undefined,
    adjust: req.body.adjust && typeof req.body.adjust === 'object' ? req.body.adjust : {},
  };
  const size = Number(req.body.size);
  exportLut(clip, Number.isFinite(size) ? size : 33)
    .then((cube) => {
      res.type('text/plain').send(cube);
    })
    .catch((err) => {
      console.error('lut-export hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🩻 Videoszkóp: egy médiakocka waveform/parade/vectorscope/histogram képe PNG-ben
app.post('/color/scope', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  const type = typeof req.body.type === 'string' ? req.body.type : 'waveform';
  scopeImage(file.path, Number.isFinite(atSec) ? atSec : 0, type)
    .then((r) => {
      cleanup();
      res.json(r);
    })
    .catch((err) => {
      cleanup();
      console.error('color-scope hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🪄 AI background removal (P1 v1, fotón): u2net CPU-n → téma-kivágás
// átlátszó háttérrel (md5-cache) — a kliens overlay-képként használja.
app.post('/bgremove', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeCutout(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        cutout: `/bgremove/${id}/cutout.png`,
        alpha: `/bgremove/${id}/alpha.png`,
      });
    })
    .catch((err) => {
      cleanup();
      console.error('bgremove hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

app.get('/bgremove/:id/:name', (req, res) => {
  const { id, name } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id) || !/^(cutout|alpha)\.png$/.test(name)) {
    res.status(400).json({ error: 'Hibás kérés.' });
    return;
  }
  const file = path.join(bgRemoveDir(id), name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'Nincs ilyen kivágás.' });
    return;
  }
  res.sendFile(file);
});

// 🧊 3D stickers (3D V1): CC0 glTF modellek three.js-szel PNG-vé renderelve
// (Chromium WebGL, fájl-cache) — a kliens overlay-képként használja őket.
app.get('/stickers3d', (_req, res) => {
  res.json({
    entries: listStickers3d().map((s) => ({
      id: s.id,
      label: s.label,
      url: `/stickers3d/${s.id}.png`,
    })),
  });
});

app.get('/stickers3d/:id.png', (req, res) => {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  renderSticker3d(req.params.id, {
    yaw: num(req.query.yaw),
    pitch: num(req.query.pitch),
    size: num(req.query.size),
    material: req.query.material,
    environment: req.query.env,
    shadow: req.query.shadow,
  })
    .then((file) => res.sendFile(file))
    .catch((err) => {
      console.error('sticker3d hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🏔️ 2.5D Photo-to-3D (🧊 3D V1): fotó → mélységbecslés (Depth-Anything V2,
// lokálisan CPU-n) → fg/mid/bg parallax-rétegek. Md5 szerint cache-elt — a
// rétegeket a render közvetlenül az assets/depth mappából olvassa, az app az
// előnézethez a GET útvonalon éri el.
app.post('/depth/parallax', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeParallaxAssets(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        layers: {
          bg: `/depth/${id}/bg.png`,
          mid: `/depth/${id}/mid.png`,
          fg: `/depth/${id}/fg.png`,
        },
      });
    })
    .catch((err) => {
      cleanup();
      console.error('depth hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🌫️/🎬 depth-extrák: portré-blur + rack-focus változatok (közös mélység-cache)
app.post('/depth/focus', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeFocusAssets(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        variants: {
          near: `/depth/${id}/focus-near.png`,
          far: `/depth/${id}/focus-far.png`,
        },
      });
    })
    .catch((err) => {
      cleanup();
      console.error('depth-focus hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

app.get('/depth/:id/:name', (req, res) => {
  const { id, name } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id) || !/^(bg|mid|fg|depth|focus-near|focus-far)\.png$/.test(name)) {
    res.status(400).json({ error: 'Hibás kérés.' });
    return;
  }
  const file = path.join(depthLayerDir(id), name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'Nincs ilyen réteg.' });
    return;
  }
  res.sendFile(file);
});

// AI-asszisztens: kontextus + utasítás → validált parancslista
app.post('/ai/assist', express.json({ limit: '2mb' }), (req, res) => {
  const { context, instruction, aiConfig } = req.body ?? {};
  if (!instruction || typeof instruction !== 'string') {
    res.status(400).json({ error: 'Hiányzó utasítás.' });
    return;
  }
  runAssistant(context ?? {}, instruction, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('AI hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// AI Edit Engine (P0-1): elemzett jelek → 3 vágás-változat (keep-sávok +
// felirat-javaslatok) — a kliens fordítja commandokká és kér jóváhagyást.
app.post('/ai/autoedit', express.json({ limit: '2mb' }), (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runAutoEdit(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('AutoEdit hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// Auto-caption: médiafájl → hang kinyerése → Whisper → SRT.
// A kliens a kapott SRT-t a meglévő import-útvonalon dolgozza fel.
app.post('/captions', upload.any(), (req, res) => {
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
app.post('/waveform', upload.any(), (req, res) => {
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
app.post('/media/upload', upload.any(), async (req, res) => {
  if (!s3Enabled()) {
    res.status(503).json({ error: 'storage nincs konfigurálva (S3_* env)' });
    return;
  }
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  try {
    const extRaw = path.extname(f.originalname || '') || `.${(f.mimetype || '').split('/')[1] || 'bin'}`;
    const ext = extRaw.replace(/[^.\w]/g, '');
    const key = `feed/${crypto.randomUUID()}${ext}`;
    await uploadFile(key, f.path, f.mimetype);
    res.json({ url: publicUrl(key), key });
  } catch (err) {
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

app.post('/render', upload.any(), (req, res) => {
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

  // ☁️ FELHŐ-MÓD (csak a küszöbnél hosszabb videóra): média S3-ba, job a queue-ba —
  // külön worker(ek) renderelnek (skálázható, túléli az API-újraindítást).
  if (queueEnabled() && s3Enabled() && totalDuration > CLOUD_MIN_SEC) {
    const id = crypto.randomBytes(8).toString('hex');
    (async () => {
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
      await enqueueRender(id, { project, settings: settingsRaw });
    })()
      .then(() => res.json({ id, mode: 'cloud' }))
      .catch((err) => {
        console.error('render enqueue hiba:', err.message);
        res.status(500).json({ error: err.message });
      });
    return;
  }

  const id = crypto.randomBytes(8).toString('hex');
  jobs.set(id, { state: 'processing', progress: 0, dir: workDir });
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
    settings
  )
    .then((file) => {
      jobs.set(id, { state: 'done', file, dir: workDir });
    })
    .catch((err) => {
      console.error(`[${id}] render hiba:`, err.message);
      jobs.set(id, { state: 'error', error: err.message, dir: workDir });
    });
});

// Jelenet-detektálás (Editor AI, szemantikus index): FFmpeg scene-score —
// a válasz a FORRÁS-időben értett jelenetváltás-időpontok listája + a fájl
// hossza. A küszöb (threshold, 0-1) a body-ban felülírható.
app.post('/scenes', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const raw = parseFloat(req.body.threshold);
  const threshold = Number.isFinite(raw) ? Math.min(0.9, Math.max(0.1, raw)) : 0.35;

  execFile(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, probeOut) => {
      const duration = probeErr ? 0 : parseFloat(probeOut) || 0;
      execFile(
        'ffmpeg',
        ['-i', file.path, '-an',
         // a metadata=print a naplóra (stderr) ír — a pipe:1 a null-muxer
         // stdout-jával ütközne
         '-vf', `select='gt(scene,${threshold})',metadata=print`,
         '-f', 'null', '-'],
        { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          cleanup();
          if (err) {
            res.json({ duration, scenes: [] });
            return;
          }
          const scenes = [];
          for (const line of (stderr ?? '').split('\n')) {
            if (!line.includes('Parsed_metadata')) {
              continue;
            }
            const m = line.match(/pts_time:([\d.]+)/);
            if (m) {
              const t = parseFloat(m[1]);
              // duplikált/0-közeli időpontok kihagyva
              if (t > 0.05 && (scenes.length === 0 || t - scenes[scenes.length - 1] > 0.05)) {
                scenes.push(t);
              }
            }
          }
          res.json({ duration, scenes });
        }
      );
    }
  );
});

// Beat-analízis (P0-2 Beat Sync): BPM + beat/downbeat-rács + energia-görbe a
// FORRÁS-időben. Függőség nélküli onset/autokorrelációs elemzés (beats.js).
app.post('/beats', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  analyzeBeats(file.path)
    .then((grid) => {
      cleanup();
      res.json(grid);
    })
    .catch((err) => {
      cleanup();
      // hang nélküli / dekódolhatatlan fájl — üres rács, a kliens jelzi
      console.warn('Beat-analízis hiba:', err.message);
      res.json({ bpm: 0, beats: [], downbeats: [], energy: [], duration: 0 });
    });
});

// Pont-követés (P0-6 tracking): a megadott vászon-pont követése a szakaszon —
// NCC template-tracker (track.js), a válasz vászon-normalizált pont-sor.
app.post('/track', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  trackMedia(file.path, {
    startSec: Math.max(0, num(req.body.startSec, 0)),
    durationSec: Math.min(20, Math.max(0.5, num(req.body.durationSec, 5))),
    cx: Math.min(1, Math.max(0, num(req.body.cx, 0.5))),
    cy: Math.min(1, Math.max(0, num(req.body.cy, 0.5))),
    aspectW: num(req.body.aspectW, 9),
    aspectH: num(req.body.aspectH, 16),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.warn('Követés hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Smart Search (P0-8): jelenet-keyframe-ek vision-címkézése — a kliens küldi
// a forrás-időpontokat, a válasz időpontonként magyar leírás + címkék
// (tartalom-hash lemez-cache-sel; a modell letöltése: ollama pull qwen2.5vl:7b).
app.post('/vision/index', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  let times;
  try {
    times = JSON.parse(req.body.times ?? '[]');
  } catch {
    times = [];
  }
  if (!Array.isArray(times) || times.length === 0) {
    cleanup();
    res.status(400).json({ error: 'Hiányzó időpont-lista.' });
    return;
  }
  indexFrames(file.path, times.slice(0, 20).map((t) => Math.max(0, Number(t) || 0)), workDir)
    .then((entries) => {
      cleanup();
      res.json({ entries });
    })
    .catch((err) => {
      cleanup();
      console.warn('Vision-index hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Smart Search lekérdezés: query + dokumentumok → hasonlóság-pontok
// (nomic-embed-text a lokális Ollamában).
app.post('/vision/query', express.json({ limit: '1mb' }), (req, res) => {
  const { query, docs } = req.body ?? {};
  if (!query || !Array.isArray(docs) || docs.length === 0) {
    res.status(400).json({ error: 'Hiányzó lekérdezés vagy dokumentumok.' });
    return;
  }
  queryScores(String(query), docs.slice(0, 200).map((d) => String(d).slice(0, 500)))
    .then((scores) => res.json({ scores }))
    .catch((err) => {
      console.warn('Vision-query hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Thumbnail Studio (Creative Canvas): a legjobb borítókép-kockák kiválasztása
// (élesség+kontraszt pontozás) — a válasz base64 JPEG-ek listája.
app.post('/thumbnails', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const count = Math.min(6, Math.max(1, parseInt(req.body.count, 10) || 4));
  pickThumbnails(file.path, { count, workDir })
    .then((thumbs) => {
      const out = thumbs.map((t) => ({
        t: t.t,
        score: t.score,
        jpegBase64: fs.readFileSync(t.file).toString('base64'),
      }));
      cleanup();
      res.json({ thumbs: out });
    })
    .catch((err) => {
      cleanup();
      console.warn('Thumbnail hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Auto Reframe (P0-7): a téma középpont-útja a szakaszon (mozgás-centroid) —
// forrás-normalizált pontok + forrás-méret; a kliens fordít crop-kulcskockákra.
app.post('/reframe', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  analyzeReframe(file.path, {
    startSec: Math.max(0, num(req.body.startSec, 0)),
    durationSec: Math.min(60, Math.max(0.5, num(req.body.durationSec, 10))),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.warn('Reframe hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Csend-detektálás (Editor AI cut-listák): FFmpeg silencedetect — a válasz a
// FORRÁS-időben értett csend-intervallumok listája + a fájl hossza. Hang
// nélküli fájlra üres lista jön (nem hiba).
app.post('/silence', upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const noise = /^-?\d+dB$/.test(req.body.noise ?? '') ? req.body.noise : '-35dB';
  const minSilence = Math.min(5, Math.max(0.2, parseFloat(req.body.minSilence) || 0.5));

  execFile(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, probeOut) => {
      const duration = probeErr ? 0 : parseFloat(probeOut) || 0;
      execFile(
        'ffmpeg',
        ['-i', file.path, '-vn',
         '-af', `silencedetect=noise=${noise}:d=${minSilence}`,
         '-f', 'null', '-'],
        { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          cleanup();
          if (err) {
            // nincs hang-stream — csend-információ nélkül megy tovább a kliens
            res.json({ duration, silences: [] });
            return;
          }
          const silences = [];
          let current = null;
          for (const line of (stderr ?? '').split('\n')) {
            const s = line.match(/silence_start:\s*(-?[\d.]+)/);
            const e = line.match(/silence_end:\s*([\d.]+)/);
            if (s) {
              current = Math.max(0, parseFloat(s[1]));
            }
            if (e && current !== null) {
              silences.push({ start: current, end: parseFloat(e[1]) });
              current = null;
            }
          }
          // a fájl végéig tartó csendet nem zárja silence_end sor
          if (current !== null && duration > current) {
            silences.push({ start: current, end: duration });
          }
          res.json({ duration, silences });
        }
      );
    }
  );
});

// Vágási proxy (full-plan F2): a nagy felbontású videóból 720p-s, gyorsan
// dekódolható munka-példány készül — az app előnézete ezt játssza, a render
// az eredetivel fut. Ha a forrás eleve ≤1280 px, {skip:true} a válasz.
// Állapot/letöltés a közös job-végpontokon (/render/:id).
app.post('/proxy', upload.any(), (req, res) => {
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
      if (Math.max(dims[0], dims[1]) <= 1280) {
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
         '-vf', 'scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
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
app.post('/collect', upload.any(), (req, res) => {
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
    path.join(workDir, 'project.vided'),
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
    ['-r', '-q', out, 'project.vided', 'media'],
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

app.get('/render/:id', async (req, res) => {
  // a rövid (lokális) render a jobs-mapben van; a hosszú (felhő) a queue-ban
  const job = jobs.get(req.params.id);
  if (job) {
    res.json({ state: job.state, error: job.error, progress: job.progress });
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch(() => null);
    if (j) {
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

app.get('/render/:id/file', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    if (job.state !== 'done') {
      res.status(404).json({ error: 'A render még nem készült el.' });
      return;
    }
    res.sendFile(job.file);
    return;
  }
  if (queueEnabled()) {
    const j = await getRenderJob(req.params.id).catch(() => null);
    if (j && j.state === 'completed' && j.returnvalue?.outKey) {
      const url = publicUrl(j.returnvalue.outKey);
      if (url) {
        res.redirect(url);
        return;
      }
    }
  }
  res.status(404).json({ error: 'A render még nem készült el.' });
});

// Storage-gateway (full-plan F2): távoli források (WebDAV/NAS…) listázása és
// auth-proxys streamelése — a hitelesítés a storage.config.json-ban, a kliens
// sosem látja. Új forrás: server/storage.config.json (lásd .example).
app.get('/storage/sources', (_req, res) => {
  const { describeSources } = require('./storage');
  res.json({ sources: describeSources() });
});

app.get('/storage/:sourceId/list', (req, res) => {
  const { listSource } = require('./storage');
  listSource(req.params.sourceId)
    .then((entries) => {
      if (entries === null) {
        res.status(404).json({ error: 'Ismeretlen forrás.' });
        return;
      }
      res.json({ entries });
    })
    .catch((err) => res.status(502).json({ error: err.message }));
});

// hossz-lekérdezés hozzáadás előtt: az ffprobe a saját gateway-URL-t olvassa
// (faststart médiánál csak a fejlécet tölti le, nem a teljes fájlt)
app.get('/storage/:sourceId/probe', (req, res) => {
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  const selfUrl = `http://127.0.0.1:${PORT}/storage/${encodeURIComponent(
    req.params.sourceId
  )}/file?path=${encodeURIComponent(rel)}`;
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

app.get('/storage/:sourceId/file', (req, res) => {
  const { streamSourceFile } = require('./storage');
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  streamSourceFile(req.params.sourceId, rel, res).catch((err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    }
  });
});

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

// a music/library mappa változhat futás közben — a cache 30 mp-enként frissül
setInterval(() => {
  libraryCache = null;
  mediaLibCache = null;
}, 30 * 1000).unref();

app.listen(PORT, () => {
  console.log(`vided render worker: http://localhost:${PORT}`);
  ensureSfx()
    .then(() => console.log('SFX-könyvtár kész (server/assets/sfx)'))
    .catch(() => {});
});
