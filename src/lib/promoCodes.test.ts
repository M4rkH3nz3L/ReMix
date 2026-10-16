import {
  normalizePromoCode,
  isExpired,
  redemptionDecision,
  promoReward,
  applyPercentDiscount,
  type PromoCode,
} from '@/lib/promoCodes';

const NOW = Date.parse('2026-06-15T12:00:00Z');

function code(over: Partial<PromoCode> = {}): PromoCode {
  return { code: 'LAUNCH10', kind: 'percent', value: 10, active: true, ...over };
}

describe('normalizePromoCode', () => {
  it('trim + nagybetű (case-insensitive beváltás)', () => {
    expect(normalizePromoCode('  launch10 ')).toBe('LAUNCH10');
    expect(normalizePromoCode('CrEaToR')).toBe('CREATOR');
    expect(normalizePromoCode('')).toBe('');
  });
});

describe('isExpired', () => {
  it('nincs expiry → sosem jár le; múltbeli → lejárt; jövőbeli → él', () => {
    expect(isExpired({ expiresAt: null }, NOW)).toBe(false);
    expect(isExpired({ expiresAt: '2026-01-01T00:00:00Z' }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: '2027-01-01T00:00:00Z' }, NOW)).toBe(false);
  });
});

describe('redemptionDecision — precedencia: invalid → inactive → expired → global → per-user', () => {
  const ctx = { nowMs: NOW, userRedemptions: 0, globalRedemptions: 0 };

  it('érvényes, friss kód → ok', () => {
    expect(redemptionDecision(code(), ctx)).toEqual({ ok: true, reason: 'ok' });
  });

  it('hiányzó/rossz kód → invalid', () => {
    expect(redemptionDecision(null, ctx).reason).toBe('invalid');
    expect(redemptionDecision({ code: '', kind: 'percent', value: 10 } as PromoCode, ctx).reason).toBe('invalid');
  });

  it('inaktív → inactive', () => {
    expect(redemptionDecision(code({ active: false }), ctx).reason).toBe('inactive');
  });

  it('lejárt → expired', () => {
    expect(redemptionDecision(code({ expiresAt: '2026-01-01T00:00:00Z' }), ctx).reason).toBe('expired');
  });

  it('globális limit elérve → limit_reached', () => {
    expect(
      redemptionDecision(code({ maxRedemptions: 100 }), { ...ctx, globalRedemptions: 100 }).reason
    ).toBe('limit_reached');
  });

  it('per-user limit (alap 1) elérve → per_user_limit_reached', () => {
    expect(redemptionDecision(code(), { ...ctx, userRedemptions: 1 }).reason).toBe('per_user_limit_reached');
    // explicit perUserLimit:2 → a 2.-ig enged
    expect(redemptionDecision(code({ perUserLimit: 2 }), { ...ctx, userRedemptions: 1 }).ok).toBe(true);
    expect(redemptionDecision(code({ perUserLimit: 2 }), { ...ctx, userRedemptions: 2 }).reason).toBe('per_user_limit_reached');
  });

  it('a precedencia: lejárt ÉS limit → expired (a lejárat előbb dönt)', () => {
    expect(
      redemptionDecision(code({ expiresAt: '2026-01-01T00:00:00Z', maxRedemptions: 1 }), {
        ...ctx,
        globalRedemptions: 5,
      }).reason
    ).toBe('expired');
  });
});

describe('promoReward — klampelt jutalom', () => {
  it('percent 1–100 közé szorítva + kerekítve', () => {
    expect(promoReward({ kind: 'percent', value: 10 })).toEqual({ kind: 'percent', value: 10 });
    expect(promoReward({ kind: 'percent', value: 250 })).toEqual({ kind: 'percent', value: 100 });
    expect(promoReward({ kind: 'percent', value: 0 })).toEqual({ kind: 'percent', value: 1 });
  });
  it('credit / proDays nem-negatív egész', () => {
    expect(promoReward({ kind: 'credit', value: 50.4 })).toEqual({ kind: 'credit', value: 50 });
    expect(promoReward({ kind: 'proDays', value: -5 })).toEqual({ kind: 'proDays', value: 0 });
  });
});

describe('applyPercentDiscount', () => {
  it('kedvezmény lefelé kerekítve, nem-negatív', () => {
    expect(applyPercentDiscount(1000, 10)).toBe(900);
    expect(applyPercentDiscount(999, 10)).toBe(899); // 999 - 99.9 = 899.1 → 899
    expect(applyPercentDiscount(100, 150)).toBe(0); // clamp 100% → 0 marad
    expect(applyPercentDiscount(0, 10)).toBe(0);
  });
});
