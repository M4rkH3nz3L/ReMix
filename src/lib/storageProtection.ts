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

// ── Írás-idejű kvóta-döntés (a record_storage_object szerver-enforce kliens-tükre) ──
// A szerver akkor blokkol, ha `(used − existing + bytes) > quota` (SZIGORÚ >); ez a
// mag ugyanezt mondja ki a hard-block UX-előnézethez, MIELŐTT a user feltölt.

/** Innentől figyelmeztet a UI (a kvóta hányada). */
export const QUOTA_WARN_FRACTION = 0.8;

export type QuotaStatus = 'ok' | 'warn' | 'full';

/** Szabad bájt (nem-negatív). */
export function remainingBytes(usedBytes: number, quotaBytes: number): number {
  return Math.max(0, Math.max(0, quotaBytes) - Math.max(0, usedBytes));
}

/** Kihasználtság 0–1+ (túllépve >1); kvóta ≤ 0 → 1 ha van használat, különben 0. */
export function usedFraction(usedBytes: number, quotaBytes: number): number {
  const q = Math.max(0, quotaBytes);
  const used = Math.max(0, usedBytes);
  if (q <= 0) {
    return used > 0 ? 1 : 0;
  }
  return used / q;
}

/** Megjelenítés-státusz: tele (nincs szabad) / figyelmeztet (≥80%) / ok. */
export function quotaStatus(usedBytes: number, quotaBytes: number): QuotaStatus {
  const q = Math.max(0, quotaBytes);
  const used = Math.max(0, usedBytes);
  if (used >= q) {
    return 'full';
  }
  return q > 0 && used / q >= QUOTA_WARN_FRACTION ? 'warn' : 'ok';
}

export interface StoreOpts {
  /** a FELÜLÍRT objektum mérete (replace nem duplázza a használatot) */
  replacingBytes?: number;
}

export interface StoreDecision {
  allowed: boolean;
  remainingBytes: number;
  /** ennyivel lépné túl a kvótát (0 ha belefér) */
  overBy: number;
  reason: 'ok' | 'quota_exceeded';
}

/** Egy `addBytes`-os írás döntése (a szerver `>`-tükör + replace-szemantika). */
export function storeDecision(
  usedBytes: number,
  quotaBytes: number,
  addBytes: number,
  opts: StoreOpts = {},
): StoreDecision {
  const replacing = Math.max(0, opts.replacingBytes ?? 0);
  const q = Math.max(0, quotaBytes);
  const effective = Math.max(0, Math.max(0, usedBytes) - replacing + Math.max(0, addBytes));
  const over = effective - q;
  const allowed = over <= 0;
  return {
    allowed,
    remainingBytes: Math.max(0, q - effective),
    overBy: Math.max(0, over),
    reason: allowed ? 'ok' : 'quota_exceeded',
  };
}

/** Belefér-e az írás kvóta-túllépés nélkül (hard-block előnézet). */
export function canStore(usedBytes: number, quotaBytes: number, addBytes: number, opts: StoreOpts = {}): boolean {
  return storeDecision(usedBytes, quotaBytes, addBytes, opts).allowed;
}

/** Hány GB bónusz kell, hogy EZ az írás beleférjen (0 ha belefér). */
export function bonusGBToFit(usedBytes: number, quotaBytes: number, addBytes: number, opts: StoreOpts = {}): number {
  const over = storeDecision(usedBytes, quotaBytes, addBytes, opts).overBy;
  return over <= 0 ? 0 : Math.ceil(over / GB_BYTES);
}

/** Az írás befogadásának HAVI coin-költsége (a hiányzó GB-okra, 0 ha belefér). */
export function coinToFit(usedBytes: number, quotaBytes: number, addBytes: number, opts: StoreOpts = {}): number {
  return monthlyCoinForBonus(bonusGBToFit(usedBytes, quotaBytes, addBytes, opts));
}
