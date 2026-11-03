import {
  addonAllowed,
  addonPeriodCents,
  periodPriceCents,
  proratedChargeCents,
  prorationCreditCents,
  remainingFraction,
  renewalCostCents,
  suggestUpgrade,
  tierChangeKind,
  upgradeCostCents,
} from '@/lib/subscriptionPlan';

const DAY = 86400000;
const start = Date.parse('2026-11-01T00:00:00Z');
const end = start + 30 * DAY;

describe('subscriptionPlan — időarányos számolás', () => {
  it('remainingFraction a periódus szélein szorítva', () => {
    expect(remainingFraction(start, end, start)).toBe(1);
    expect(remainingFraction(start, end, start + 15 * DAY)).toBe(0.5);
    expect(remainingFraction(start, end, end + DAY)).toBe(0);
    expect(remainingFraction(start, start, start)).toBe(0);
  });

  it('jóváírás lefelé, díj felfelé kerekítve', () => {
    expect(prorationCreditCents(200, start, end, start + 10 * DAY)).toBe(133); // 200 × 2/3 = 133,3
    expect(proratedChargeCents(100, start, end, start + 10 * DAY)).toBe(67); // 100 × 2/3 = 66,7
  });

  it('felfelé váltás félidőben: Amatőr → Profi = 8 − 1 Coin', () => {
    expect(
      upgradeCostCents({ fromTier: 'basic', toTier: 'ultra', period: 'month', startMs: start, endMs: end, nowMs: start + 15 * DAY })
    ).toBe(700);
  });

  it('éves periódus: 10 havi díj; a jóváírás az éves díjból', () => {
    expect(periodPriceCents('pro', 'year')).toBe(4000);
    const yEnd = start + 365 * DAY;
    expect(
      upgradeCostCents({ fromTier: 'pro', toTier: 'ultra', period: 'year', startMs: start, endMs: yEnd, nowMs: start })
    ).toBe(8000 - 4000);
  });

  it('a váltás fajtája', () => {
    expect(tierChangeKind('free', 'pro')).toBe('start');
    expect(tierChangeKind('pro', 'pro')).toBe('same');
    expect(tierChangeKind('basic', 'ultra')).toBe('upgrade');
    expect(tierChangeKind('ultra', 'basic')).toBe('downgrade');
  });
});

describe('subscriptionPlan — add-on', () => {
  it('minimum-szint: a 100 GB és a multistream Haladótól', () => {
    expect(addonAllowed('storage_100gb', 'basic')).toBe(false);
    expect(addonAllowed('storage_100gb', 'pro')).toBe(true);
    expect(addonAllowed('storage_10gb', 'basic')).toBe(true);
    expect(addonAllowed('ai_1m', 'free')).toBe(false);
  });

  it('a PRO-CASH 3.3 példája: Amatőr + 10 GB + 1 M AI = 4 Coin, és felajánljuk a Haladót', () => {
    const cost = renewalCostCents({
      tier: 'basic',
      period: 'month',
      addons: [{ id: 'storage_10gb', qty: 1 }, { id: 'ai_1m', qty: 1 }],
    });
    expect(cost).toBe(400);
    expect(suggestUpgrade('basic', 200)).toBe('pro');
    expect(suggestUpgrade('basic', 100)).toBeNull();
    expect(suggestUpgrade('ultra', 9999)).toBeNull();
  });

  it('a levett add-on a megújításkor már nem fizetendő; éves periódusnál × 12', () => {
    expect(
      renewalCostCents({ tier: 'pro', period: 'month', addons: [{ id: 'render_60', qty: 2, cancelAtPeriodEnd: true }] })
    ).toBe(400);
    expect(addonPeriodCents('publish_account', 1, 'year')).toBe(480);
  });
});
