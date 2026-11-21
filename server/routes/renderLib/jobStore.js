// 🎬 A lokális render/proxy/collect jobok közös in-memory tára + a TTL-söprés (a routes/render.js-ből).
// A modul betöltésekor indul az időzítő — pontosan egyszer, mint eredetileg a router betöltésekor.
const { StampedJobs, sweepFinishedJobs } = require('../../lib/jobSweep');

const jobs = new StampedJobs(); // id → { state, file?, error?, dir, userId?, abort?, updatedAt }
// A38: a lezárt job (és a feltöltött hang, a kimenet) legfeljebb ennyi ideig marad a lemezen
const JOB_TTL_MS = Number(process.env.RENDER_JOB_TTL_MS) || 60 * 60 * 1000;
setInterval(() => sweepFinishedJobs(jobs, Date.now(), JOB_TTL_MS), Math.min(JOB_TTL_MS, 10 * 60 * 1000)).unref();

module.exports = { jobs };
