import {
  addUsage,
  canUse,
  getUsage,
  isNewPeriod,
  isOverQuota,
  isUnlimited,
  periodKey,
  quotaFor,
  remaining,
  resetIfNewPeriod,
  seatQuota,
  BUSINESS_MIN_SEATS,
  usageRatio,
  USAGE_METRICS,
  type UsageQuota,
} from '@/lib/usageMeter';
import { TIER_ORDER } from '@/lib/tiers';

describe('usageMeter — kvóták (audit §2.2)', () => {
  it('minden tierhez van kvóta, minden metrikára', () => {
    for (const tier of TIER_ORDER) {
      const q = quotaFor(tier);
      for (const m of USAGE_METRICS) {
        expect(typeof q[m]).toBe('number');
      }
    }
  });

  it('monoton: magasabb tier ≥ alacsonyabb (a korlátlant -1=∞-ként, a Vállalatit min. ülésszámmal)', () => {
    const val = (q: UsageQuota, m: (typeof USAGE_METRICS)[number]) => (q[m] < 0 ? Infinity : q[m]);
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lo = seatQuota(TIER_ORDER[i - 1], BUSINESS_MIN_SEATS);
      const hi = seatQuota(TIER_ORDER[i], BUSINESS_MIN_SEATS);
      for (const m of USAGE_METRICS) {
        expect(val(hi, m)).toBeGreaterThanOrEqual(val(lo, m));
      }
    }
  });

  it('PRO-CASH 3.1: a Free a felhőből semmit nem kap (AI-token, render-perc = 0)', () => {
    expect(quotaFor('free').aiTokens).toBe(0);
    expect(quotaFor('free').renderMinutes).toBe(0);
    expect(quotaFor('basic')).toMatchObject({ aiTokens: 200000, renderMinutes: 30 });
    expect(quotaFor('pro')).toMatchObject({ aiTokens: 1000000, renderMinutes: 120 });
    expect(quotaFor('ultra')).toMatchObject({ aiTokens: 3000000, renderMinutes: 400 });
  });

  it('a Vállalati kvóta fejenkénti: × ülésszám, min. 2 fő; a korlátlan korlátlan marad', () => {
    expect(seatQuota('business', 5).aiTokens).toBe(10000000);
    expect(seatQuota('business', 1).renderMinutes).toBe(600);
    expect(isUnlimited(seatQuota('business', 5), 'exports')).toBe(true);
    expect(seatQuota('pro', 9)).toEqual(quotaFor('pro'));
  });
});

describe('usageMeter — fogyasztás + kvóta-ellenőrzés', () => {
  const q = { aiTokens: 20000, renderMinutes: 10, exports: 15, cloudJobs: 25 }; // rögzített tesztkvóta

  it('addUsage immutábilis + akkumulál; negatív → 0', () => {
    const c0 = {};
    const c1 = addUsage(c0, 'aiTokens', 5000);
    expect(getUsage(c1, 'aiTokens')).toBe(5000);
    expect(getUsage(c0, 'aiTokens')).toBe(0); // eredeti változatlan
    const c2 = addUsage(c1, 'aiTokens', 3000);
    expect(getUsage(c2, 'aiTokens')).toBe(8000);
    expect(getUsage(addUsage(c2, 'aiTokens', -100), 'aiTokens')).toBe(8000);
  });

  it('remaining / canUse / isOverQuota', () => {
    const c = { aiTokens: 19000 };
    expect(remaining(c, q, 'aiTokens')).toBe(1000);
    expect(canUse(c, q, 'aiTokens', 1000)).toBe(true);
    expect(canUse(c, q, 'aiTokens', 1001)).toBe(false);
    expect(isOverQuota(c, q, 'aiTokens')).toBe(false);
    expect(isOverQuota({ aiTokens: 20000 }, q, 'aiTokens')).toBe(true);
  });

  it('korlátlan metrika: remaining=∞, mindig canUse, sosem over', () => {
    const uq = quotaFor('pro'); // exports: korlátlan
    expect(remaining({ exports: 1e9 }, uq, 'exports')).toBe(Infinity);
    expect(canUse({ exports: 1e9 }, uq, 'exports', 1e9)).toBe(true);
    expect(isOverQuota({ exports: 1e9 }, uq, 'exports')).toBe(false);
  });

  it('usageRatio 0–1; korlátlanra 0', () => {
    expect(usageRatio({ aiTokens: 10000 }, q, 'aiTokens')).toBeCloseTo(0.5);
    expect(usageRatio({ aiTokens: 40000 }, q, 'aiTokens')).toBe(1); // clamp
    expect(usageRatio({ exports: 1e9 }, quotaFor('pro'), 'exports')).toBe(0);
  });
});

describe('usageMeter — havi periódus (reset, audit §2.3)', () => {
  it('periodKey UTC YYYY-MM', () => {
    expect(periodKey(new Date('2026-10-05T12:00:00Z'))).toBe('2026-10');
    expect(periodKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });

  it('isNewPeriod: hónapváltásra / hiányzó periódusra igaz', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(isNewPeriod('2026-10', now)).toBe(false);
    expect(isNewPeriod('2026-09', now)).toBe(true);
    expect(isNewPeriod(null, now)).toBe(true);
  });

  it('resetIfNewPeriod: új hónap → nulláz + periódust frissít; azonos hónap → változatlan', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const stale = { period: '2026-09', counters: { aiTokens: 12345 } };
    const reset = resetIfNewPeriod(stale, now);
    expect(reset).toEqual({ period: '2026-10', counters: {} });

    const current = { period: '2026-10', counters: { aiTokens: 500 } };
    expect(resetIfNewPeriod(current, now)).toBe(current); // referencia-azonos (no-op)
  });
});
