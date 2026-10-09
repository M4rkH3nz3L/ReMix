import { type Tier, tierMeetsMin } from '@/lib/tiers';
import type { Asset, Project } from '@/types/project';

/**
 * 🗄️ Tárhely-POLITIKA (free vs fizetős) — TISZTA mag (ADR-013).
 *
 * Termék-szabály:
 *  - **Free:** a média a FELHASZNÁLÓ ESZKÖZÉN marad (lokális fájl). A MI R2-
 *    tárunkba NEM töltjük fel automatikusan → nincs felhő-biztonsági háló: ha az
 *    appot törlik / a tárhelyet ürítik, a média ELVESZIK. A felhasználót erről
 *    PROAKTÍVAN tájékoztatjuk (lásd `projectMediaSafety` + a szerkesztő bannere).
 *    A projekt-TERV (JSON) felhő-mentése ettől függetlenül megy (adatbiztonság).
 *  - **Fizetős (Pro+):** a média a **Cloudflare R2**-re mentődik (auto-backup),
 *    és a foglalt bájt SZERVER-HITELESEN mérve (`storage_objects` / `storage_usage`)
 *    — ez a **beárazás alapja** (`storageBillingBasis`).
 *
 * SZÁNDÉKOSAN expo-mentes (csak tier + típus import) → önmagában tesztelhető.
 */

/** A MI R2-tárunkba való auto-média-backup minimális (fizetős) szintje. */
export const MEDIA_BACKUP_MIN_TIER: Tier = 'pro';

/**
 * Jogosult-e a user a MI felhő-tárunkba (R2) való AUTOMATIKUS média-backupra.
 * Free → `false` (a média az eszközön marad). A user SAJÁT külső tára
 * (Drive/Dropbox/…) ettől független (azt a szerver „aktív cél" útja kezeli).
 */
export function canCloudBackupMedia(tier: Tier): boolean {
  return tierMeetsMin(tier, MEDIA_BACKUP_MIN_TIER);
}

function isMediaAsset(a: Asset): boolean {
  return a.kind === 'video' || a.kind === 'image' || a.kind === 'audio';
}

/** Csak az eszközön lévő (felhő-másolat nélküli, nem-http) média-asset. */
function isLocalOnly(a: Asset): boolean {
  return isMediaAsset(a) && !a.remoteUrl && !!a.uri && !/^https?:\/\//i.test(a.uri);
}

export interface MediaSafety {
  /** a MI felhőnkbe mentett (remoteUrl-es) média-assetek száma */
  backedUp: number;
  /** CSAK az eszközön lévő (felhő-másolat nélküli) média-assetek száma */
  localOnly: number;
  /** stream-forrásból (http) hivatkozott média (nem a mi tárunk, nem is lokális kockázat) */
  remote: number;
  /** van-e kockázatos (csak-eszközön lévő) média → a free-figyelmeztetés kapuja */
  atRisk: boolean;
}

/**
 * A projekt média-biztonsági állapota: hány asset van felhőben mentve vs. csak az
 * eszközön. A szerkesztő ebből dönti el, mutasson-e a free-usernek adatvesztés-
 * figyelmeztetést (`atRisk`).
 */
export function projectMediaSafety(project: Project): MediaSafety {
  let backedUp = 0;
  let localOnly = 0;
  let remote = 0;
  for (const a of project.assets) {
    if (!isMediaAsset(a)) {
      continue;
    }
    if (a.remoteUrl) {
      backedUp += 1;
    } else if (a.uri && /^https?:\/\//i.test(a.uri)) {
      remote += 1;
    } else if (isLocalOnly(a)) {
      localOnly += 1;
    }
  }
  return { backedUp, localOnly, remote, atRisk: localOnly > 0 };
}

const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface StorageBillingBasis {
  usedGB: number;
  includedGB: number;
  /** a befoglaltságon FELÜLi, díjköteles rész (GB, 0 ha belefér) */
  overageGB: number;
  /** a díjköteles rész becsült HAVI költsége (coin), a `coinPerGBMonth`-szal */
  estimatedCoinPerMonth: number;
}

/**
 * A fizetős R2-használat **beárazás-alapja** a szerver-hiteles bájtokból. A
 * `usedBytes`/`includedBytes` a `storage_usage` RPC-ből (used/base); a felüli rész
 * a díjköteles overage. A tényleges árazást a termék dönti el — ez a determinisztikus,
 * tesztelhető számítási alap. (A meglévő boost-ráta: `STORAGE_COIN_PER_GB_MONTH`.)
 */
export function storageBillingBasis(
  usedBytes: number,
  includedBytes: number,
  coinPerGBMonth: number
): StorageBillingBasis {
  const usedGB = Math.max(0, usedBytes) / BYTES_PER_GB;
  const includedGB = Math.max(0, includedBytes) / BYTES_PER_GB;
  const overageGB = Math.max(0, usedGB - includedGB);
  return {
    usedGB,
    includedGB,
    overageGB,
    estimatedCoinPerMonth: Math.ceil(overageGB) * coinPerGBMonth,
  };
}
