// 📊 Observability & cost — PURE derivációk (05-observability §05.2/§05.4/§05.5).
// A mennyiség-mérés forrása a usage_counters (usage.js) + a worker-registry + a
// render-sor pillanatkép; itt NEM mérünk, csak LESZÁRMAZTATUNK (cost/margin/metrika),
// hogy admin-dashboard/monitoring fogyaszthassa. Minden fn tiszta → tesztelhető.

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

/** Egységárak (Ft), env-konfigurálható (nem hardkódolt — §05.4). */
function unitPrices(env = process.env) {
  return {
    renderMinuteFt: num(env.COST_RENDER_MIN_FT, 8),
    aiTokenFt: num(env.COST_AI_TOKEN_FT, 0.002),
    storageGbMonthFt: num(env.COST_STORAGE_GB_FT, 5),
    egressGbFt: num(env.COST_EGRESS_GB_FT, 3),
  };
}

/**
 * Becsült költség a mért mennyiségekből × egységár (§05.4).
 * @param {{renderMinutes?:number, aiTokens?:number, storageGb?:number, egressGb?:number}} usage
 */
function estimateCost(usage = {}, prices = unitPrices()) {
  const render = num(usage.renderMinutes, 0) * prices.renderMinuteFt;
  const ai = num(usage.aiTokens, 0) * prices.aiTokenFt;
  const storage = num(usage.storageGb, 0) * prices.storageGbMonthFt;
  const egress = num(usage.egressGb, 0) * prices.egressGbFt;
  return { render, ai, storage, egress, total: render + ai + storage + egress };
}

/** Margin = bevétel − költség (§05.4). Pozitív = nyereséges. */
function margin(revenueFt, costTotalFt) {
  return num(revenueFt, 0) - num(costTotalFt, 0);
}

/**
 * Sor-mélység-metrikák a listRenderJobs() pillanatképből (§05.2). A `saturated`
 * (minden slot foglalt ÉS van várakozó) a worker-hiány/autoscale-jel.
 */
function queueMetrics(snapshot = {}) {
  const waiting = Array.isArray(snapshot.waiting) ? snapshot.waiting.length : 0;
  const active = Array.isArray(snapshot.active) ? snapshot.active.length : 0;
  const concurrency = num(snapshot.concurrency, 0);
  return {
    waiting,
    active,
    concurrency,
    backlog: waiting,
    saturated: concurrency > 0 && active >= concurrency && waiting > 0,
  };
}

/**
 * Per-worker ops-telemetria a listWorkers() kimenetből + `now` (§05.5):
 * uptime, aktív-jobok, concurrency-kihasználtság.
 */
function fleetTelemetry(workers = [], now = Date.now()) {
  return (Array.isArray(workers) ? workers : []).map((w) => {
    const activeJobs = Array.isArray(w.activeJobs) ? w.activeJobs.length : 0;
    const concurrency = num(w.concurrency, 0);
    return {
      id: w.id,
      roleKey: w.roleKey ?? null,
      status: w.status ?? null,
      concurrency,
      activeJobs,
      uptimeSec: w.startedAt ? Math.max(0, Math.round((now - w.startedAt) / 1000)) : 0,
      utilization: concurrency > 0 ? Math.min(1, activeJobs / concurrency) : 0,
    };
  });
}

module.exports = { unitPrices, estimateCost, margin, queueMetrics, fleetTelemetry };
