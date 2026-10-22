// 📊 In-memory kérés-metrikák (05-observability §05.2) — a `/metrics` endpoint forrása.
//
// SZÁNDÉKOSAN egyszerű: process-lokális számlálók (restart-tal nullázódnak), a go-live
// alap-megfigyelhetőséghez (kérés-szám, status-osztály, error-ráta, latency, uptime)
// elég. A külső monitor (dashboard / scrape) a `/metrics`-ből olvas; a hosszú-távú
// aggregáció (Prometheus/Grafana) go-live-infra, nem ennek a rétegnek a dolga.
//
// PURE + injektálható (nowMs) → hálózat nélkül tesztelhető.

let startedAtMs = Date.now();
const counters = {
  total: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
  errors: 0, // 5xx
  latencySumMs: 0,
  latencyMaxMs: 0,
  latencyCount: 0, // az érvényes latency-mintá száma (az avg ezzel oszt, nem a total-lal)
};

/** HTTP-status → osztály-kulcs ('2xx'…'5xx'); tartományon kívül → 'other'. */
function statusClass(status) {
  const s = Number(status);
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500 && s < 600) return '5xx';
  return 'other';
}

/** Egy LEZÁRULT kérés rögzítése (status-kód + időtartam ms). */
function recordRequest(status, durationMs) {
  counters.total += 1;
  const cls = statusClass(status);
  counters.byClass[cls] += 1;
  if (cls === '5xx') {
    counters.errors += 1;
  }
  const d = Number(durationMs);
  if (Number.isFinite(d) && d >= 0) {
    counters.latencySumMs += d;
    counters.latencyCount += 1;
    if (d > counters.latencyMaxMs) {
      counters.latencyMaxMs = d;
    }
  }
}

/** Pillanatkép a `/metrics`-hez: uptime + kérés-összesítők + error-ráta + latency. */
function metricsSnapshot(nowMs = Date.now()) {
  const total = counters.total;
  return {
    uptimeSec: Math.max(0, Math.round((nowMs - startedAtMs) / 1000)),
    requests: {
      total,
      byClass: { ...counters.byClass },
      errorRate: total > 0 ? Number((counters.errors / total).toFixed(4)) : 0,
    },
    latency: {
      avgMs: counters.latencyCount > 0 ? Math.round(counters.latencySumMs / counters.latencyCount) : 0,
      maxMs: Math.round(counters.latencyMaxMs),
    },
  };
}

/** Teszt-reset: a számlálók + az uptime-óra nullázása. */
function resetMetrics(nowMs = Date.now()) {
  startedAtMs = nowMs;
  counters.total = 0;
  counters.byClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
  counters.errors = 0;
  counters.latencySumMs = 0;
  counters.latencyMaxMs = 0;
  counters.latencyCount = 0;
}

module.exports = { recordRequest, metricsSnapshot, statusClass, resetMetrics };
