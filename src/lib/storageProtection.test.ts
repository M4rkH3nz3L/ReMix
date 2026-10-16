import {
  GB_BYTES,
  QUOTA_WARN_FRACTION,
  bonusGBToFit,
  canStore,
  checkDowngrade,
  coinToFit,
  coinToKeepContent,
  monthlyCoinForBonus,
  quotaStatus,
  remainingBytes,
  requiredBonusGB,
  storageDowngradeBlocked,
  storeDecision,
  usedFraction,
} from './storageProtection';
import { STORAGE_COIN_PER_GB_MONTH } from './storageQuota';

describe('storageProtection — adatvesztés-védelem + coin-recurring (TECH-TOP §5)', () => {
  test('storageDowngradeBlocked: a használat fölé esés blokkolt', () => {
    expect(storageDowngradeBlocked(5 * GB_BYTES, 3 * GB_BYTES)).toBe(true); // 5 GB használat > 3 GB új kvóta
    expect(storageDowngradeBlocked(3 * GB_BYTES, 3 * GB_BYTES)).toBe(false); // pont elfér
    expect(storageDowngradeBlocked(2 * GB_BYTES, 10 * GB_BYTES)).toBe(false);
    expect(storageDowngradeBlocked(1 * GB_BYTES, -1)).toBe(true); // érvénytelen kvóta → 0
  });

  test('requiredBonusGB: a használat és az alap közti rés felfelé kerekítve', () => {
    expect(requiredBonusGB(1 * GB_BYTES, 10 * GB_BYTES)).toBe(0); // belefér
    expect(requiredBonusGB(12 * GB_BYTES, 10 * GB_BYTES)).toBe(2); // 2 GB túl
    expect(requiredBonusGB(10.5 * GB_BYTES, 10 * GB_BYTES)).toBe(1); // 0.5 GB → 1 GB (ceil)
  });

  test('monthlyCoinForBonus: GB × a havi coin/GB', () => {
    expect(monthlyCoinForBonus(0)).toBe(0);
    expect(monthlyCoinForBonus(3)).toBe(3 * STORAGE_COIN_PER_GB_MONTH);
    expect(monthlyCoinForBonus(1.2)).toBe(2 * STORAGE_COIN_PER_GB_MONTH); // ceil
  });

  test('coinToKeepContent: a megtartás havi coin-költsége', () => {
    expect(coinToKeepContent(5 * GB_BYTES, 10 * GB_BYTES)).toBe(0); // belefér → 0
    expect(coinToKeepContent(13 * GB_BYTES, 10 * GB_BYTES)).toBe(3 * STORAGE_COIN_PER_GB_MONTH); // 3 GB
  });

  test('checkDowngrade: biztonságos vs fizetős-megtartás', () => {
    expect(checkDowngrade(2 * GB_BYTES, 10 * GB_BYTES)).toEqual({ safe: true, bonusGB: 0, monthlyCoin: 0 });
    expect(checkDowngrade(14 * GB_BYTES, 10 * GB_BYTES)).toEqual({
      safe: false,
      bonusGB: 4,
      monthlyCoin: 4 * STORAGE_COIN_PER_GB_MONTH,
    });
  });
});

describe('írás-idejű kvóta-döntés — record_storage_object szerver-tükre (§02 hard-block)', () => {
  const Q = 10 * GB_BYTES;

  test('remainingBytes / usedFraction nem-negatív, kvóta ≤ 0 kezelve', () => {
    expect(remainingBytes(3 * GB_BYTES, Q)).toBe(7 * GB_BYTES);
    expect(remainingBytes(12 * GB_BYTES, Q)).toBe(0); // túllépve → 0
    expect(usedFraction(8 * GB_BYTES, Q)).toBeCloseTo(0.8, 10);
    expect(usedFraction(5, 0)).toBe(1); // nincs kvóta, van használat → tele
    expect(usedFraction(0, 0)).toBe(0);
  });

  test('quotaStatus: ok < 80% ≤ warn < tele', () => {
    expect(quotaStatus(5 * GB_BYTES, Q)).toBe('ok');
    expect(quotaStatus(QUOTA_WARN_FRACTION * Q, Q)).toBe('warn');
    expect(quotaStatus(Q, Q)).toBe('full'); // 0 szabad
    expect(quotaStatus(11 * GB_BYTES, Q)).toBe('full');
  });

  test('storeDecision: a SZIGORÚ > tükre — pont tele belefér, +1 bájt blokkol', () => {
    expect(storeDecision(9 * GB_BYTES, Q, 1 * GB_BYTES)).toMatchObject({ allowed: true, overBy: 0, reason: 'ok' });
    // pont a kvótára tölt → effective == quota → NEM > quota → enged
    expect(storeDecision(Q, Q, 0).allowed).toBe(true);
    const blocked = storeDecision(Q, Q, 1);
    expect(blocked).toMatchObject({ allowed: false, overBy: 1, reason: 'quota_exceeded' });
  });

  test('replace nem duplázza a használatot (replacingBytes)', () => {
    // tele a kvóta, de egy 2 GB-os meglévőt cserélünk 2 GB-ra → belefér
    expect(canStore(Q, Q, 2 * GB_BYTES, { replacingBytes: 2 * GB_BYTES })).toBe(true);
    // 2 GB-ost cserélünk 3 GB-ra tele kvótán → 1 GB-tal túllép
    expect(storeDecision(Q, Q, 3 * GB_BYTES, { replacingBytes: 2 * GB_BYTES }).overBy).toBe(1 * GB_BYTES);
  });

  test('bonusGBToFit / coinToFit: a konkrét íráshoz hiányzó GB és havi coin', () => {
    expect(bonusGBToFit(8 * GB_BYTES, Q, 1 * GB_BYTES)).toBe(0); // belefér
    expect(bonusGBToFit(9 * GB_BYTES, Q, 2.5 * GB_BYTES)).toBe(2); // 1.5 GB túl → ceil 2
    expect(coinToFit(9 * GB_BYTES, Q, 2.5 * GB_BYTES)).toBe(2 * STORAGE_COIN_PER_GB_MONTH);
    expect(coinToFit(1 * GB_BYTES, Q, 1 * GB_BYTES)).toBe(0);
  });
});
