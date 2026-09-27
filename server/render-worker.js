// Render-worker: a queue-ból húzza a render-jobokat, letölti az S3-inputokat,
// renderel (renderProject), és a kész MP4-et S3-ba tölti + progresszt jelent.
// Indítás: `REDIS_URL=... S3_...=... node render-worker.js` (több példány =
// vízszintes skálázás; a BullMQ osztja szét a jobokat).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('bullmq');

const { connection, QUEUE_NAME } = require('./queue');
const { downloadFile, uploadFile } = require('./s3store');
const { renderProject } = require('./render');
const { notifyAvailable, sendNotification } = require('./notify');
const { putWorker, removeWorker } = require('./workers-registry');

const CONCURRENCY = parseInt(process.env.RENDER_CONCURRENCY || '2', 10);

if (!process.env.REDIS_URL) {
  console.error('A render-workerhez REDIS_URL (és S3_* env) kell. Lásd server/.env.example.');
  process.exit(1);
}

// 🖥️ Worker-identitás a „Sor" nézethez. A NÉV és LEÍRÁS a kliensen fordul
// (roleKey → i18n), így mindenki a saját nyelvén látja, mit csinál a worker.
// Az ikon (ionicon-név) és a szerep env-vel felülírható (több worker-típushoz).
const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}#${process.pid}`;
const WORKER_SHORT = process.env.WORKER_SHORT || String(process.pid);
const WORKER_ICON = process.env.WORKER_ICON || 'film-outline';
const WORKER_ROLE = process.env.WORKER_ROLE || 'render';
const STARTED_AT = Date.now();

// jobId → { jobId, projectName, phaseKey, progress } — a párhuzamosan futó
// (concurrency) feladatok élő állapota; a heartbeat ezt tükrözi a regiszterbe.
const activeJobs = new Map();

async function heartbeat() {
  await putWorker({
    id: WORKER_ID,
    shortId: WORKER_SHORT,
    icon: WORKER_ICON,
    roleKey: WORKER_ROLE,
    concurrency: CONCURRENCY,
    status: activeJobs.size > 0 ? 'busy' : 'idle',
    activeJobs: [...activeJobs.values()],
    startedAt: STARTED_AT,
  }).catch(() => {}); // best-effort: a heartbeat sose döntse el a rendert
}

/** A job aktuális fázisának beállítása + azonnali heartbeat (a „Sor" reszponzív). */
function setPhase(job, phaseKey, progress) {
  const cur = activeJobs.get(job.id) || {
    jobId: job.id,
    projectName: job.data?.projectName || null,
    userId: job.data?.userId || null,
    phaseKey,
    progress: 0,
  };
  cur.phaseKey = phaseKey;
  if (typeof progress === 'number') {
    cur.progress = progress;
  }
  activeJobs.set(job.id, cur);
  void heartbeat();
}

/** A projekt minden `s3:<key>` uri-ját letölti workDir-be és lokális útra írja. */
async function rehydrateInputs(project, workDir) {
  const map = new Map(); // s3key → localPath (dedup)
  const resolve = async (uri) => {
    if (typeof uri !== 'string' || !uri.startsWith('s3:')) {
      return uri;
    }
    const key = uri.slice(3);
    if (!map.has(key)) {
      const local = path.join(workDir, `in_${map.size}_${path.basename(key)}`);
      await downloadFile(key, local);
      map.set(key, local);
    }
    return map.get(key);
  };
  for (const track of project.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if ('uri' in clip && clip.uri) {
        clip.uri = await resolve(clip.uri);
      }
      if (clip.kind === 'shape' && clip.imageUri) {
        clip.imageUri = await resolve(clip.imageUri);
      }
    }
  }
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { project, settings } = job.data;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-render-'));
    try {
      // 1) médiafájlok betöltése az S3-ból
      setPhase(job, 'download', 0);
      await rehydrateInputs(project, workDir);
      // 2) renderelés (a valós ffmpeg-haladás 0-100) — a Redis-be a heartbeat
      //    írja ki (nem minden tick, hogy ne terheljük fölöslegesen)
      setPhase(job, 'render', 0);
      const out = await renderProject(
        project,
        workDir,
        (p) => {
          const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
          job.updateProgress(pct); // finom (per-tick) haladás a share-flow pollingnak
          const cur = activeJobs.get(job.id);
          if (cur) {
            cur.progress = pct; // a heartbeat ~5 mp-enként tükrözi
          }
        },
        settings || {}
      );
      // 3) kész fájl feltöltése — a kiterjesztés a rendertől jön (videó VAGY
      //    hang-only export: wav/mp3/m4a/flac), a content-type ehhez igazodik
      setPhase(job, 'upload', 100);
      const ext = (path.extname(out) || '.mp4').toLowerCase();
      const CTYPE = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
      };
      const outKey = `${job.id}/out${ext}`;
      await uploadFile(outKey, out, CTYPE[ext] || 'application/octet-stream');
      return { outKey };
    } finally {
      activeJobs.delete(job.id);
      void heartbeat(); // a befejezett feladat azonnal lekerül a workerről
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* nem fatális */
      }
    }
  },
  { connection: connection(), concurrency: CONCURRENCY }
);

// 🔔 A job GAZDÁJÁNAK értesítése (a `render` típus a klienst a „Sor" nézetre
// viszi tap-re; realtime + háttér-push a notify.js-en át). Best-effort: ha a
// service_role nincs bekötve (notifyAvailable=false), csak logolunk.
function notifyOwner(job, ok, errMessage) {
  const d = job?.data || {};
  if (!d.userId || !notifyAvailable()) {
    return;
  }
  const name = d.projectName ? `„${d.projectName}"` : 'A videód';
  sendNotification({
    userId: d.userId,
    type: 'render',
    title: ok ? 'Kész a renderelés' : 'Sikertelen renderelés',
    body: ok
      ? `${name} elkészült — megnézheted és megoszthatod.`
      : `${name} renderelése nem sikerült${errMessage ? `: ${String(errMessage).slice(0, 160)}` : '.'}`,
    route: '/schedules',
    data: { jobId: job.id, projectId: d.projectId || null, ok },
  }).catch((e) => console.warn('[render-worker] értesítés hiba:', e.message));
}

worker.on('completed', (job) => {
  console.log(`[render-worker] ✓ ${job.id}`);
  notifyOwner(job, true);
});
worker.on('failed', (job, err) => {
  console.log(`[render-worker] ✗ ${job?.id}: ${err?.message}`);
  // csak a VÉGLEGES bukásnál értesítünk (a BullMQ újrapróbál `attempts`-ig)
  if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
    notifyOwner(job, false, err?.message);
  }
});
worker.on('error', (err) => console.error('[render-worker] error:', err.message));

// 🫀 Heartbeat: azonnal + 5 mp-enként bejelentkezik a regiszterbe (a bejegyzés
// TTL-je 20 mp, így egy összeomlott worker magától eltűnik a listából).
void heartbeat();
const beatTimer = setInterval(() => void heartbeat(), 5000);

// 🧹 Rendezett leállás: levesszük a workert a listáról, elköszönünk a queue-tól.
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearInterval(beatTimer);
  console.log(`[render-worker] leállás (${sig})…`);
  try {
    await removeWorker(WORKER_ID);
    await worker.close();
  } catch {
    /* leállásnál nem érdekel */
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(
  `render-worker fut — queue "${QUEUE_NAME}", id ${WORKER_ID}, concurrency ${CONCURRENCY}`
);
