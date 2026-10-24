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
const { log, makeRequestId } = require('./lib/log');
const { recordRequest, metricsSnapshot } = require('./metrics');

const app = express();

// kérés-napló (diagnosztika): honnan jön a hívás és mire — a „nem érhető el”
// hibáknál ebből látszik, hogy a kérés egyáltalán megérkezik-e
app.use((req, res, next) => {
  // 🪵 05-observability §05.1: strukturált, korrelálható kérés-napló (request-id)
  req.id = makeRequestId();
  log.info('req', { reqId: req.id, method: req.method, path: req.path, ip: req.ip });
  // 📊 05.2: a LEZÁRULT kérés metrikája (status-osztály + latency) a /metrics-hez
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    recordRequest(res.statusCode, Number(process.hrtime.bigint() - startNs) / 1e6);
  });
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

// 📊 05-observability §05.2: process-metrikák (kérés-szám, status-osztály, error-ráta,
// latency, uptime) a külső monitornak/dashboardnak. Hitelesítés mögött (nem publikus).
app.get('/metrics', authenticated(), (_req, res) => {
  res.json({ ok: true, ...metricsSnapshot() });
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
// 🎚️ Hang-generáló route-ok (synth/drums/sampler/spektrogram) — domain-router (§01.1).
app.use(require('./routes/audioGen'));

// 🗑️ Account (GDPR hard-erase) — domain-router (§01.1).
app.use(require('./routes/account'));

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



// 🎬🎧 Média route-ok — domain-router (§01.1).
app.use(require('./routes/media'));
// 📲 átviteli tár: eszköz→eszköz .rp továbbítás (24h TTL, kvótán kívüli, méret-plafonos)
app.use(require('./routes/transfer'));

// 🖼️ Kép-eszköz route-ok — domain-router (§01.1).
app.use(require('./routes/imageTools'));



// 💰 Tárhely-kvóta + kifizetés — domain-router (§01.1).
app.use(require('./routes/wallet'));

// 🎬 Render route-ok (render/proxy/collect/queue/:id*) — domain-router (§01.1).
app.use(require('./routes/render'));

// 🎛️ Editor-analízis route-ok — domain-router (§01.1).
app.use(require('./routes/analysis'));



// 🔌 Storage-gateway: a user SAJÁT külső forrásai (Google Drive / Dropbox / WebDAV
// / S3) a `user_storage_providers` táblából + a legacy globális admin-config
// (storage.config.json). A hitelesítés (OAuth token/kulcs) a WORKEREN marad — a
// kliens sosem látja, csak a proxyzott végpontokat. Minden route requireAuth.
// 🗄️ Külső tárhely-providerek (Drive/Dropbox/WebDAV/S3) — domain-router (§01.1).
app.use(require('./routes/storage'));

// médiatár: a server/library mappa videó/kép/hang fájljai (app „Tár" panel)
// 📚 Média-tár + zene route-ok — domain-router (§01.1).
app.use(require('./routes/library'));

// 🧯 Egységes hiba-handler a lánc VÉGÉN (01-api-architecture §01.3): a route-okból
// dobott HttpError / next(err) egységes JSON-alakra ({ error, code?, issues? }).
app.use(errorHandler);

// 🚀 A szerver CSAK közvetlen indításkor figyel + futtat háttér-ciklusokat
// (node index.js). Teszt-importkor (require('./index')) NEM fut a listen/interval —
// így a route-réteg integrációs teszttel vizsgálható (01-api-architecture §01.1).
if (require.main === module) {
  // 🔒 04-security §04.1: prod-ban a dev-kapuk (ALLOW_INSECURE_DEV/RL_DISABLED/
  // ALLOW_DEV_BILLING) auth/rate-limit/billing védelmet kapcsolnak ki → az indulás
  // megtagadva, ha bármelyik be van kapcsolva production-ben (go-live blokkoló).
  require('./security/prodGates').assertProdGates();

  // 🧯 05-observability §05.3: nem-kezelt hibák strukturált logba (a process ne haljon
  // némán) — a külső monitor/alerting ebből riaszt. Best-effort, a logging sosem dob.
  process.on('unhandledRejection', (reason) =>
    log.error('unhandledRejection', { reason: String((reason && reason.message) || reason) })
  );
  process.on('uncaughtException', (err) => log.error('uncaughtException', { error: err && err.message }));

  // 💰 F3: a túl hosszú élő-adásokat (egress) periodikusan auto-stop (költségkontroll).
  // Csak akkor fut valóban, ha az egress + service_role konfigurált (egressConfigured).
  const { sweepStaleEgress } = require('./liveEgress');
  setInterval(() => {
    sweepStaleEgress().catch(() => {});
  }, 5 * 60 * 1000).unref();

  // 🗑️ GDPR hard-erase sweep (03-production §03.4): a lejárt-cooldownú soft-delete-elt
  // fiókok NAPONTA automatikusan véglegesen törlődnek (storage-purge + auth-user-delete +
  // audit). CSAK ha `ALLOW_ACCOUNT_ERASE=1` + van service_role admin-kliens; különben no-op
  // (nem élesben is biztonságos). Egy indulás-utáni futás (1 perc) + 24h-s ismétlés. A
  // host-cron/sidecar alternatíva: `node server/eraseSweep.js` (CLI-entrypoint).
  const { eraseSweepEnabled, runEraseSweepOnce } = require('./eraseSweep');
  const eraseAdmin = require('./notify').adminClient();
  if (eraseSweepEnabled(process.env, !!eraseAdmin)) {
    const runSweep = () =>
      runEraseSweepOnce({ sb: eraseAdmin, logger: log }).catch((e) =>
        log.error('erase-sweep', { error: e && e.message })
      );
    setTimeout(runSweep, 60 * 1000).unref();
    setInterval(runSweep, 24 * 60 * 60 * 1000).unref();
    log.info('erase-sweep ütemezve', { intervalHours: 24 });
  }

  app.listen(PORT, () => {
    console.log(`vided render worker: http://localhost:${PORT}`);
    ensureSfx()
      .then(() => console.log('SFX-könyvtár kész (server/assets/sfx)'))
      .catch(() => {});
  });
}

module.exports = app;
