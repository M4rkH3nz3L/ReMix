// 📊 /metrics kérés-metrikák (05-observability §05.2) — a PURE collector tesztje.
const { recordRequest, metricsSnapshot, statusClass, resetMetrics } = require('./metrics');

describe('statusClass — HTTP-status → osztály', () => {
  test('tartományok + tartományon kívül', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(204)).toBe('2xx');
    expect(statusClass(301)).toBe('3xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(429)).toBe('4xx');
    expect(statusClass(500)).toBe('5xx');
    expect(statusClass(503)).toBe('5xx');
    expect(statusClass(100)).toBe('other');
    expect(statusClass(600)).toBe('other');
  });
});

describe('metrics collector — recordRequest + snapshot', () => {
  beforeEach(() => resetMetrics(1_000_000));

  test('üres állapot → nullák', () => {
    const s = metricsSnapshot(1_000_000);
    expect(s.requests.total).toBe(0);
    expect(s.requests.errorRate).toBe(0);
    expect(s.latency).toEqual({ avgMs: 0, maxMs: 0 });
    expect(s.uptimeSec).toBe(0);
  });

  test('kérés-szám + status-osztály + error-ráta (5xx/total)', () => {
    recordRequest(200, 10);
    recordRequest(201, 30);
    recordRequest(404, 5);
    recordRequest(500, 50);
    const s = metricsSnapshot(1_000_000);
    expect(s.requests.total).toBe(4);
    expect(s.requests.byClass).toMatchObject({ '2xx': 2, '4xx': 1, '5xx': 1 });
    expect(s.requests.errorRate).toBe(0.25); // 1 db 5xx / 4
  });

  test('latency avg + max (érvényes mintákból)', () => {
    recordRequest(200, 10);
    recordRequest(200, 30);
    recordRequest(200, 20);
    const s = metricsSnapshot(1_000_000);
    expect(s.latency.avgMs).toBe(20); // (10+30+20)/3
    expect(s.latency.maxMs).toBe(30);
  });

  test('érvénytelen latency (NaN/negatív) KIMARAD az avg-ból, de a kérés számít', () => {
    recordRequest(200, 10);
    recordRequest(200, NaN);
    recordRequest(200, -5);
    const s = metricsSnapshot(1_000_000);
    expect(s.requests.total).toBe(3); // mindhárom kérés számít
    expect(s.latency.avgMs).toBe(10); // de csak az 1 érvényes (10ms) latency az avg-ban
  });

  test('uptime a reset-óra óta', () => {
    resetMetrics(1_000_000);
    expect(metricsSnapshot(1_000_000 + 5000).uptimeSec).toBe(5);
  });
});
