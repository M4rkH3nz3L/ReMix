// 🧹 Render-jobok lejárata (PRO-AUDIO A38): a memóriás job-tár eddig soha nem ürült, így a
// feltöltött hang és a kész kimenet a szerver újraindításáig a lemezen maradt. A lezárt job
// (kész, hiba, megszakítva) a TTL után a mappájával együtt törlődik; a futót nem bántjuk.

const fs = require('fs');
const { logCaught } = require('./caught');

const TERMINAL = new Set(['done', 'error', 'cancelled']);

/** Job-tár, ami minden írásnál időbélyeget tesz a jobra (a lejárat ehhez mér). */
class StampedJobs extends Map {
  set(id, job) {
    return super.set(id, { ...job, updatedAt: Date.now() });
  }
}

function sweepFinishedJobs(jobs, now, ttlMs, removeDir = (dir) => fs.rmSync(dir, { recursive: true, force: true })) {
  let removed = 0;
  for (const [id, job] of jobs) {
    if (!TERMINAL.has(job.state) || now - (job.updatedAt ?? now) < ttlMs) {
      continue;
    }
    if (job.dir) {
      try {
        removeDir(job.dir);
      } catch (caught) {
        logCaught('lib/jobSweep.js:sweepFinishedJobs', caught);
      }
    }
    jobs.delete(id);
    removed += 1;
  }
  return removed;
}

module.exports = { StampedJobs, sweepFinishedJobs, TERMINAL };
