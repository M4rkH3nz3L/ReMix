import {
  applyDiscount,
  couponReward,
  couponStatus,
  discountAmount,
  isRedeemable,
  normalizeCode,
  type Coupon,
} from '@/lib/coupons';

const NOW = new Date('2026-10-06T12:00:00Z');
const base = (over: Partial<Coupon> = {}): Coupon => ({ code: 'SAVE20', kind: 'percent', value: 20, ...over });

describe('normalizeCode', () => {
  it('trim + nagybetű + belső szóköz el', () => {
    expect(normalizeCode('  save 20 ')).toBe('SAVE20');
    expect(normalizeCode('welcome')).toBe('WELCOME');
    expect(normalizeCode('')).toBe('');
  });
});

describe('couponStatus (audit §2.9)', () => {
  it('valid alap esetben', () => {
    expect(couponStatus(base(), { now: NOW })).toBe('valid');
    expect(isRedeemable(base(), { now: NOW })).toBe(true);
  });
  it('disabled, ha enabled=false', () => {
    expect(couponStatus(base({ enabled: false }), { now: NOW })).toBe('disabled');
  });
  it('notStarted / expired az időablakból', () => {
    expect(couponStatus(base({ startsAt: '2026-11-01T00:00:00Z' }), { now: NOW })).toBe('notStarted');
    expect(couponStatus(base({ expiresAt: '2026-10-01T00:00:00Z' }), { now: NOW })).toBe('expired');
    // határokon belül valid
    expect(
      couponStatus(base({ startsAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' }), { now: NOW }),
    ).toBe('valid');
  });
  it('exhausted, ha elérte a maxRedemptions-t', () => {
    const c = base({ maxRedemptions: 100 });
    expect(couponStatus(c, { now: NOW, redemptions: 99 })).toBe('valid');
    expect(couponStatus(c, { now: NOW, redemptions: 100 })).toBe('exhausted');
  });
  it('tierLocked, ha a user szintje a minTier alatt van', () => {
    const c = base({ minTier: 'pro' });
    expect(couponStatus(c, { now: NOW, userTier: 'free' })).toBe('tierLocked');
    expect(couponStatus(c, { now: NOW, userTier: 'pro' })).toBe('valid');
    expect(couponStatus(c, { now: NOW, userTier: 'ultra' })).toBe('valid');
  });
});

describe('applyDiscount / discountAmount', () => {
  it('percent', () => {
    expect(applyDiscount(base({ kind: 'percent', value: 20 }), 100)).toBe(80);
    expect(discountAmount(base({ kind: 'percent', value: 20 }), 100)).toBe(20);
    expect(applyDiscount(base({ kind: 'percent', value: 150 }), 100)).toBe(0); // clamp 100%
  });
  it('amount (nem megy negatívba)', () => {
    expect(applyDiscount(base({ kind: 'amount', value: 30 }), 100)).toBe(70);
    expect(applyDiscount(base({ kind: 'amount', value: 200 }), 100)).toBe(0);
  });
  it('credits/proDays nem módosítja az árat; 0 ár → 0', () => {
    expect(applyDiscount(base({ kind: 'credits', value: 500 }), 100)).toBe(100);
    expect(applyDiscount(base({ kind: 'proDays', value: 30 }), 100)).toBe(100);
    expect(applyDiscount(base(), 0)).toBe(0);
  });
});

describe('couponReward', () => {
  it('credits / proDays jutalom; ár-kuponnál nulla', () => {
    expect(couponReward(base({ kind: 'credits', value: 500 }))).toEqual({ credits: 500, proDays: 0 });
    expect(couponReward(base({ kind: 'proDays', value: 30 }))).toEqual({ credits: 0, proDays: 30 });
    expect(couponReward(base({ kind: 'percent', value: 20 }))).toEqual({ credits: 0, proDays: 0 });
    expect(couponReward(base({ kind: 'credits', value: -5 }))).toEqual({ credits: 0, proDays: 0 });
  });
});
