const { logCaught } = require('../../lib/caught');
// 📋 GET /render/queue — a felhő-render sor nézete (pozíció, ETA, workerek) + a kliens-mezők szűrése.
// A kezelők SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/render.js-ben.
const { queueEnabled, listRenderJobs } = require('../../queue');
const { listWorkers } = require('../../workers-registry');

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
exports.renderQueueHandler = async (req, res) => {
  if (!queueEnabled()) {
    res.json({ enabled: false, concurrency: 0, jobs: [], mineAhead: null, mineEtaSec: null });
    return;
  }
  const uid = req.user?.id || (req.query.userId ? String(req.query.userId).trim() : '') || null;
  const FACTOR = Math.max(0.05, parseFloat(process.env.RENDER_ETA_FACTOR || '0.7'));
  const now = Date.now();
  try {
    const [snap, workers] = await Promise.all([listRenderJobs(), listWorkers().catch((caught) => { logCaught('routes/render.js', caught); return []; })]);
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
    logCaught('routes/render.js', err);
    console.error('render-queue hiba:', err.message);
    res.status(500).json({ error: err.message });
  }
};

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
