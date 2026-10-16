const {
  ABUSE_RULES,
  tierMultiplier,
  countWithinWindow,
  abuseThresholds,
  abuseDecision,
  smallFileAbuse,
} = require('./abuseDetect');
const { TIER_ORDER } = require('./tiers');

describe('tierMultiplier — 2^rang, a kanonikus TIER_ORDER-ből (§06.2)', () => {
  test('free×1 … business×16, minden tierre véges', () => {
    expect(tierMultiplier('free')).toBe(1);
    expect(tierMultiplier('basic')).toBe(2);
    expect(tierMultiplier('pro')).toBe(4);
    expect(tierMultiplier('ultra')).toBe(8);
    expect(tierMultiplier('business')).toBe(16);
    for (const t of TIER_ORDER) {
      expect(Number.isFinite(tierMultiplier(t))).toBe(true);
    }
  });
  test('ismeretlen tier → free-re esik vissza (×1)', () => {
    expect(tierMultiplier('zajos')).toBe(1);
  });
});

describe('countWithinWindow — csúszóablak', () => {
  test('csak az ablakon belüli, nem-jövőbeli események', () => {
    const now = 100_000;
    const ts = [now - 500, now - 59_000, now - 61_000 /* kiesik */, now + 10 /* jövő, kiesik */, now];
    expect(countWithinWindow(ts, now, 60_000)).toBe(3);
  });
  test('határeset: pontosan a windowMs-nél még benne', () => {
    expect(countWithinWindow([1000], 61_000, 60_000)).toBe(1);
    expect(countWithinWindow([999], 61_000, 60_000)).toBe(0);
  });
  test('nem-tömb / üres → 0', () => {
    expect(countWithinWindow(null, 1, 1)).toBe(0);
    expect(countWithinWindow([], 1, 1)).toBe(0);
  });
});

describe('abuseThresholds — tier-arányos skálázás', () => {
  test('free alap = ABUSE_RULES; pro ×4', () => {
    expect(abuseThresholds('ai', 'free')).toEqual({ windowMs: 60_000, warn: 30, block: 60 });
    expect(abuseThresholds('ai', 'pro')).toEqual({ windowMs: 60_000, warn: 120, block: 240 });
  });
  test('ismeretlen metrika → null', () => {
    expect(abuseThresholds('nincs-ilyen', 'pro')).toBeNull();
  });
});

describe('abuseDecision — allow / throttle / block', () => {
  const now = 1_000_000;
  const burst = (n) => Array.from({ length: n }, () => now - 1000);

  test('küszöb alatt → allow', () => {
    const d = abuseDecision({ metric: 'render', timestamps: burst(5), nowMs: now, tier: 'free' });
    expect(d.action).toBe('allow');
    expect(d.count).toBe(5);
  });
  test('warn..block között → throttle', () => {
    // render free: warn 10, block 20
    const d = abuseDecision({ metric: 'render', timestamps: burst(12), nowMs: now, tier: 'free' });
    expect(d).toMatchObject({ action: 'throttle', reason: 'render_throttle', count: 12 });
  });
  test('block felett → block', () => {
    const d = abuseDecision({ metric: 'render', timestamps: burst(25), nowMs: now, tier: 'free' });
    expect(d).toMatchObject({ action: 'block', reason: 'render_block' });
  });
  test('ugyanaz a burst magasabb tieren NEM blokkol (nem akad be a legit Pro)', () => {
    // 25 render/perc → free: block; pro (×4, block=80): allow
    const free = abuseDecision({ metric: 'render', timestamps: burst(25), nowMs: now, tier: 'free' });
    const pro = abuseDecision({ metric: 'render', timestamps: burst(25), nowMs: now, tier: 'pro' });
    expect(free.action).toBe('block');
    expect(pro.action).toBe('allow');
  });
  test('ismeretlen metrika → allow/no_rule (fail-open)', () => {
    expect(abuseDecision({ metric: 'x', timestamps: burst(999), nowMs: now, tier: 'free' })).toEqual({
      action: 'allow',
      reason: 'no_rule',
      count: 0,
    });
  });
});

describe('smallFileAbuse — tár-kvóta-kerülgetés', () => {
  test('sok apró fájl → true; kevés/nagy → false', () => {
    expect(smallFileAbuse(Array(120).fill(500), { maxBytes: 1024, minCount: 100 })).toBe(true);
    expect(smallFileAbuse(Array(50).fill(500), { maxBytes: 1024, minCount: 100 })).toBe(false);
    expect(smallFileAbuse(Array(120).fill(5_000), { maxBytes: 1024, minCount: 100 })).toBe(false);
  });
  test('nem-tömb → false; alapértékek', () => {
    expect(smallFileAbuse(null)).toBe(false);
    expect(smallFileAbuse(Array(100).fill(1))).toBe(true); // alap minCount 100
  });
});

describe('ABUSE_RULES — minden szabály warn < block', () => {
  test('konzisztens küszöbök', () => {
    for (const [metric, r] of Object.entries(ABUSE_RULES)) {
      expect(r.warn).toBeLessThan(r.block);
      expect(r.windowMs).toBeGreaterThan(0);
      expect(metric).toMatch(/^[a-z]+$/);
    }
  });
});
