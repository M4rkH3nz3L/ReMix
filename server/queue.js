// Render-job-queue (BullMQ + Redis). REDIS_URL nélkül kikapcsolt → a render a
// lokális in-process úton megy (dev). Beállítva: az API sorba tesz, a külön
// render-worker(ek) dolgozzák fel — így vízszintesen skálázható és túléli az
// API-újraindítást.
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_NAME = 'render';

function queueEnabled() {
  return Boolean(REDIS_URL);
}

let conn;
function connection() {
  if (!conn) {
    // a BullMQ workerhez maxRetriesPerRequest: null kötelező
    conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return conn;
}

let queue;
function renderQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: connection() });
  }
  return queue;
}

/**
 * 💠 Tier → BullMQ job-prioritás (audit §2.6). BullMQ-ban a KISEBB szám fut ELŐBB
 * → Ultra a leggyorsabb, Free a leglassabb (`Ultra > Pro > Basic > Free`). Ismeretlen
 * → free. A tier CSAK a SORRENDET befolyásolja (nem biztonsági; a felhő-render amúgy
 * is Pro-kapu mögött van) — a tényleges tier-differenciálás a 4-tier billing-bekötéssel
 * (§2.4) teljesedik ki; addig minden render-job egységes prioritást kap (FIFO).
 */
function tierJobPriority(tier) {
  switch (tier) {
    case 'ultra':
      return 1;
    case 'pro':
      return 2;
    case 'basic':
      return 3;
    default:
      return 4; // free / ismeretlen
  }
}

/** Sorba tesz egy render-jobot a megadott id-vel; visszaadja a job id-t. */
async function enqueueRender(jobId, payload) {
  await renderQueue().add('render', payload, {
    jobId,
    priority: tierJobPriority(payload && payload.tier), // 💠 tier-alapú sorrend (§2.6)
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 3600, count: 200 },
  });
  return jobId;
}

/** A job állapota a kliens-polling számára (state/progress/result/error). */
async function getRenderJob(id) {
  const job = await renderQueue().getJob(id);
  if (!job) {
    return null;
  }
  const state = await job.getState();
  return {
    state,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    userId: job.data?.userId ?? null, // BOLA-ellenőrzéshez (/render/:id[/file])
  };
}

/**
 * 🛑 Best-effort render-job megszakítás a sorban: a VÁRAKOZÓ (waiting/delayed/
 * paused) jobot eltávolítja; az ÉPP FUTÓ (active) ffmpeg-et a külön worker-
 * folyamatból innen nem tudjuk leállítani (kooperatív abort = követő lépés). A
 * hívó (index.js) a `userId`-vel BOLA-ellenőriz. @returns {found,userId,removed,active}
 */
async function cancelRenderJob(id) {
  const job = await renderQueue().getJob(id);
  if (!job) {
    return { found: false, userId: null, removed: false, active: false };
  }
  const state = await job.getState();
  const userId = job.data?.userId ?? null;
  if (state === 'waiting' || state === 'delayed' || state === 'paused') {
    try {
      await job.remove();
      return { found: true, userId, removed: true, active: false };
    } catch {
      return { found: true, userId, removed: false, active: false };
    }
  }
  if (state === 'active') {
    // 🛑 ÉPP FUTÓ job: a worker külön folyamatban renderel → Redis abort-flaget
    // teszünk, amit a worker figyel, és SIGKILL-je a saját ffmpeg-jét (kooperatív).
    await requestJobCancel(id).catch(() => {});
    return { found: true, userId, removed: false, active: true };
  }
  return { found: true, userId, removed: false, active: false };
}

// 🛑 Kooperatív abort-jelzés a futó render-jobnak (Redis flag, 10 perc TTL). A
// worker a feldolgozás alatt figyeli; az index.js `cancelRenderJob` állítja be.
const CANCEL_PREFIX = 'render:cancel:';
async function requestJobCancel(id) {
  await connection().set(CANCEL_PREFIX + id, '1', 'EX', 600);
}
async function isJobCancelRequested(id) {
  return (await connection().exists(CANCEL_PREFIX + id)) === 1;
}
async function clearJobCancel(id) {
  await connection().del(CANCEL_PREFIX + id);
}

/** Ahány render-worker-szál egyszerre dolgozik (a schedules-ETA ezzel skáláz). */
function renderConcurrency() {
  return Math.max(1, parseInt(process.env.RENDER_CONCURRENCY || '2', 10));
}

/** Egy BullMQ-job → a schedules-nézet nyers mezői (belső, nem exportált). */
function jobFields(job, state) {
  const d = job.data || {};
  return {
    id: job.id,
    state, // 'active' | 'waiting' | 'completed' | 'failed'
    progress: typeof job.progress === 'number' ? job.progress : 0, // 0-100
    userId: d.userId ?? null,
    projectId: d.projectId ?? null,
    projectName: d.projectName ?? null,
    durationSec: typeof d.durationSec === 'number' ? d.durationSec : 0,
    enqueuedAt: job.timestamp ?? null,
    startedAt: job.processedOn ?? null,
    finishedAt: job.finishedOn ?? null,
    failedReason: job.failedReason ?? null,
  };
}

/**
 * 📋 A render-sor pillanatképe a „Sor" (schedules) nézethez: az ÉPP futó
 * (active) és a VÁRAKOZÓ (waiting, FIFO-sorrendben) jobok + nemrég kész/hibás
 * jobok. A `waiting` a valós feldolgozási sorrend, így ebből számol pozíciót és
 * ETA-t a hívó (index.js). A `completedLimit` a lezárt jobok visszamenő plafonja.
 */
async function listRenderJobs({ completedLimit = 25 } = {}) {
  const q = renderQueue();
  const [active, waiting, completed, failed] = await Promise.all([
    q.getActive(0, 50),
    q.getWaiting(0, 300),
    q.getCompleted(0, completedLimit),
    q.getFailed(0, completedLimit),
  ]);
  return {
    concurrency: renderConcurrency(),
    active: active.map((j) => jobFields(j, 'active')),
    waiting: waiting.map((j) => jobFields(j, 'waiting')),
    completed: completed.map((j) => jobFields(j, 'completed')),
    failed: failed.map((j) => jobFields(j, 'failed')),
  };
}

module.exports = {
  queueEnabled,
  renderQueue,
  enqueueRender,
  tierJobPriority,
  getRenderJob,
  cancelRenderJob,
  requestJobCancel,
  isJobCancelRequested,
  clearJobCancel,
  listRenderJobs,
  renderConcurrency,
  connection,
  QUEUE_NAME,
};
