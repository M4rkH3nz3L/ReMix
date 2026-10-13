/**
 * 🛟 Tárhely-védelem (TECH-TOP §5) — pure + tesztelt.
 *
 * Szabály: ha a tárhely a MÁR HASZNÁLT tartalom alá csökkenne (tier-downgrade vagy a
 * bónusz lejárta), azt **NE engedjük némán adatvesztéshez vezetni** — vagy blokkoljuk,
 * vagy a hiányzó tárhelyet **coinból, HAVIDÍJBAN** tartjuk fenn (a havi ár ennyivel nő).
 * A coin/GB/hó ár a [storageQuota](./storageQuota) magból (`STORAGE_COIN_PER_GB_MONTH`).
 */
import { STORAGE_COIN_PER_GB_MONTH } from './storageQuota';

/** 1 GB bájtban (GiB). */
export const GB_BYTES = 1024 ** 3;

/** Blokkolt-e a tárhely-csökkentés? (a használat MEGHALADNÁ az új kvótát → adatvesztés) */
export function storageDowngradeBlocked(usedBytes: number, newQuotaBytes: number): boolean {
  return Math.max(0, usedBytes) > Math.max(0, newQuotaBytes);
}

/** Hány GB BÓNUSZ-tárhely kell a teljes tartalom megtartásához az adott ALAP-kvóta mellett. */
export function requiredBonusGB(usedBytes: number, baseBytes: number): number {
  const over = Math.max(0, usedBytes) - Math.max(0, baseBytes);
  return over <= 0 ? 0 : Math.ceil(over / GB_BYTES);
}

/** A bónusz-tárhely HAVI coin-költsége (recurring) — ennyivel nő a havidíj. */
export function monthlyCoinForBonus(bonusGB: number): number {
  return Math.max(0, Math.ceil(bonusGB)) * STORAGE_COIN_PER_GB_MONTH;
}

/** A tartalom-megtartáshoz szükséges HAVI coin, ha a user az adott alap-kvótára esne vissza. */
export function coinToKeepContent(usedBytes: number, baseBytes: number): number {
  return monthlyCoinForBonus(requiredBonusGB(usedBytes, baseBytes));
}

export interface DowngradeCheck {
  /** biztonságos-e a váltás adatvesztés nélkül (a jelenlegi bónusz-coinnal) */
  safe: boolean;
  /** hány GB bónusz kell a megtartáshoz */
  bonusGB: number;
  /** a megtartás HAVI coin-költsége */
  monthlyCoin: number;
}

/**
 * Tier-/kvóta-váltás vizsgálata: biztonságos-e, és ha nem, mennyi bónusz-coin (havi) tartja
 * meg a tartalmat. A hívó ebből nyit figyelmeztetőt/ajánlatot („fizess ennyit, vagy törölj").
 */
export function checkDowngrade(usedBytes: number, newBaseBytes: number): DowngradeCheck {
  const bonusGB = requiredBonusGB(usedBytes, newBaseBytes);
  return { safe: bonusGB === 0, bonusGB, monthlyCoin: monthlyCoinForBonus(bonusGB) };
}
