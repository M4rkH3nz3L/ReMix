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

const CONCURRENCY = parseInt(process.env.RENDER_CONCURRENCY || '2', 10);

if (!process.env.REDIS_URL) {
  console.error('A render-workerhez REDIS_URL (és S3_* env) kell. Lásd server/.env.example.');
  process.exit(1);
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
      await rehydrateInputs(project, workDir);
      const out = await renderProject(
        project,
        workDir,
        (p) => job.updateProgress(Math.round(Math.min(1, Math.max(0, p)) * 100)),
        settings || {}
      );
      const outKey = `${job.id}/out.mp4`;
      await uploadFile(outKey, out, 'video/mp4');
      return { outKey };
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* nem fatális */
      }
    }
  },
  { connection: connection(), concurrency: CONCURRENCY }
);

worker.on('completed', (job) => console.log(`[render-worker] ✓ ${job.id}`));
worker.on('failed', (job, err) => console.log(`[render-worker] ✗ ${job?.id}: ${err?.message}`));
worker.on('error', (err) => console.error('[render-worker] error:', err.message));

console.log(`render-worker fut — queue "${QUEUE_NAME}", concurrency ${CONCURRENCY}`);
