const { unitPrices, estimateCost, margin, queueMetrics, fleetTelemetry } = require('./observability');

describe('unitPrices — env-konfigurálható egységárak (§05.4)', () => {
  test('alapértékek + env-felülírás', () => {
    const def = unitPrices({});
    expect(def.renderMinuteFt).toBe(8);
    expect(def.aiTokenFt).toBe(0.002);
    const over = unitPrices({ COST_RENDER_MIN_FT: '12', COST_STORAGE_GB_FT: '7' });
    expect(over.renderMinuteFt).toBe(12);
    expect(over.storageGbMonthFt).toBe(7);
  });
});

describe('estimateCost + margin — determinisztikus (§05.4)', () => {
  const prices = { renderMinuteFt: 10, aiTokenFt: 0.001, storageGbMonthFt: 5, egressGbFt: 3 };

  test('mennyiség × egységár → tételes + total', () => {
    const c = estimateCost({ renderMinutes: 30, aiTokens: 100_000, storageGb: 2, egressGb: 4 }, prices);
    expect(c.render).toBe(300); // 30 × 10
    expect(c.ai).toBe(100); // 100000 × 0.001
    expect(c.storage).toBe(10); // 2 × 5
    expect(c.egress).toBe(12); // 4 × 3
    expect(c.total).toBe(422);
  });

  test('hiányzó/negatív mennyiség → 0 (nem NaN)', () => {
    const c = estimateCost({ renderMinutes: -5 }, prices);
    expect(c.total).toBe(0);
  });

  test('margin = bevétel − költség', () => {
    expect(margin(1000, 422)).toBe(578);
    expect(margin(300, 422)).toBe(-122); // veszteséges
    expect(margin('x', 100)).toBe(-100); // rossz bevétel → 0 − 100
  });
});

describe('queueMetrics — sor-mélység (§05.2)', () => {
  test('waiting/active/backlog + saturated (minden slot foglalt + várakozó)', () => {
    const m = queueMetrics({ concurrency: 2, active: [{}, {}], waiting: [{}, {}, {}] });
    expect(m).toEqual({ waiting: 3, active: 2, concurrency: 2, backlog: 3, saturated: true });
  });

  test('van szabad slot → nem saturated; üres → 0-k', () => {
    expect(queueMetrics({ concurrency: 4, active: [{}], waiting: [{}] }).saturated).toBe(false);
    expect(queueMetrics({})).toEqual({ waiting: 0, active: 0, concurrency: 0, backlog: 0, saturated: false });
  });
});

describe('fleetTelemetry — per-worker ops-telemetria (§05.5)', () => {
  test('uptime + utilization + aktív-jobok 2 workerre', () => {
    const now = 1_000_000;
    const t = fleetTelemetry(
      [
        { id: 'w1', roleKey: 'render', status: 'busy', concurrency: 2, activeJobs: [{}], startedAt: now - 60_000 },
        { id: 'w2', roleKey: 'render', status: 'idle', concurrency: 2, activeJobs: [], startedAt: now - 10_000 },
      ],
      now
    );
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ id: 'w1', activeJobs: 1, uptimeSec: 60, utilization: 0.5 });
    expect(t[1]).toMatchObject({ id: 'w2', activeJobs: 0, uptimeSec: 10, utilization: 0 });
  });

  test('üres flotta → []', () => {
    expect(fleetTelemetry([], 1)).toEqual([]);
    expect(fleetTelemetry(null, 1)).toEqual([]);
  });
});
