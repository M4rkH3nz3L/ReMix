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

/** Sorba tesz egy render-jobot a megadott id-vel; visszaadja a job id-t. */
async function enqueueRender(jobId, payload) {
  await renderQueue().add('render', payload, {
    jobId,
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
  };
}

module.exports = { queueEnabled, renderQueue, enqueueRender, getRenderJob, connection, QUEUE_NAME };
