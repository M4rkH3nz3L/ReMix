import {
  GB_BYTES,
  checkDowngrade,
  coinToKeepContent,
  monthlyCoinForBonus,
  requiredBonusGB,
  storageDowngradeBlocked,
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
