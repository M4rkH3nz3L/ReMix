import type { Tier } from '@/lib/tiers';

/**
 * 📊 Usage-metering mag (audit §2.2) — tiszta, expo-mentes.
 *
 * A drága felhő-erőforrások havi mérése + tier-kvóta. A **storage KÜLÖN rendszer**
 * ([storageQuota.ts](./storageQuota.ts) + `server/quota.js`), ezért itt NINCS — ez a
 * modul a nem-mért metrikákat fedi: AI-token, felhő-render-perc, export-szám,
 * felhő-job-szám. Tierenkénti kvóta a [tiers.ts](./tiers.ts) szintjeihez kötve.
 *
 * Determinisztikus (a periódus-logika injektált `Date`-ből) → unit-tesztelhető. A
 * server-authoritatív tárolás (`usage_counters` tábla) + enforcement a bekötés (§2.2/§2.3);
 * ez a modul a HITELES logika, amit a kliens (soft-warning) és a worker (hard-enforce) is használ.
 */

export type UsageMetric = 'aiTokens' | 'renderMinutes' | 'exports' | 'cloudJobs';
export const USAGE_METRICS: readonly UsageMetric[] = [
  'aiTokens',
  'renderMinutes',
  'exports',
  'cloudJobs',
];

export type UsageCounters = Partial<Record<UsageMetric, number>>;
/** Havi kvóta metrikánként. `-1` = korlátlan. */
export type UsageQuota = Record<UsageMetric, number>;

/**
 * Tierenkénti HAVI kvóták. `-1` = korlátlan. (Termék-döntés, hangolható — a billing-
 * bekötéskor env/DB-ből is jöhet; a storage NEM itt van.) A rangsor monoton: magasabb
 * tier ≥ alacsonyabb (ultra mindenhol a legbővebb / korlátlan).
 */
export const TIER_QUOTAS: Record<Tier, UsageQuota> = {
  free: { aiTokens: 20000, renderMinutes: 10, exports: 15, cloudJobs: 25 },
  basic: { aiTokens: 100000, renderMinutes: 60, exports: 100, cloudJobs: 150 },
  pro: { aiTokens: 500000, renderMinutes: 300, exports: -1, cloudJobs: -1 },
  ultra: { aiTokens: -1, renderMinutes: -1, exports: -1, cloudJobs: -1 },
};

export function quotaFor(tier: Tier): UsageQuota {
  return TIER_QUOTAS[tier];
}

export function getUsage(c: UsageCounters, m: UsageMetric): number {
  return c[m] ?? 0;
}

/** Fogyasztás hozzáadása (immutábilis; negatív bemenet 0-ra szorítva). */
export function addUsage(c: UsageCounters, m: UsageMetric, amount: number): UsageCounters {
  return { ...c, [m]: getUsage(c, m) + Math.max(0, amount) };
}

export function isUnlimited(quota: UsageQuota, m: UsageMetric): boolean {
  return quota[m] < 0;
}

/** Hátralévő mennyiség (`Infinity`, ha korlátlan). */
export function remaining(c: UsageCounters, quota: UsageQuota, m: UsageMetric): number {
  if (isUnlimited(quota, m)) {
    return Infinity;
  }
  return Math.max(0, quota[m] - getUsage(c, m));
}

/** Belefér-e még `amount` a kvótába (gate: ezt kérdezi a worker a drága hívás előtt). */
export function canUse(c: UsageCounters, quota: UsageQuota, m: UsageMetric, amount = 1): boolean {
  return remaining(c, quota, m) >= amount;
}

/** Elérte/túllépte-e a kvótát. */
export function isOverQuota(c: UsageCounters, quota: UsageQuota, m: UsageMetric): boolean {
  return !isUnlimited(quota, m) && getUsage(c, m) >= quota[m];
}

/** Használati arány 0–1 (0, ha korlátlan v. nulla kvóta) — a progress-UI-hoz. */
export function usageRatio(c: UsageCounters, quota: UsageQuota, m: UsageMetric): number {
  if (isUnlimited(quota, m) || quota[m] === 0) {
    return 0;
  }
  return Math.min(1, getUsage(c, m) / quota[m]);
}

// ── havi periódus (reset) ───────────────────────────────────────────────────

/** A dátum havi periódus-kulcsa: `YYYY-MM` (UTC — időzóna-független a resethez). */
export function periodKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Új havi periódus kezdődött-e a `lastPeriod` óta (vagy nincs még periódus). */
export function isNewPeriod(lastPeriod: string | null | undefined, now: Date): boolean {
  return !lastPeriod || lastPeriod !== periodKey(now);
}

export interface UsageState {
  /** a jelenleg mért periódus kulcsa (`YYYY-MM`) */
  period: string;
  counters: UsageCounters;
}

/**
 * Ha új hónap van, NULLÁZZA a számlálókat + frissíti a periódust (ez a „havi reset",
 * audit §2.3 — a server-oldalon pg_cron is ezt teszi; itt a hiteles logika). Különben
 * változatlanul adja vissza az állapotot.
 */
export function resetIfNewPeriod(state: UsageState, now: Date): UsageState {
  if (isNewPeriod(state.period, now)) {
    return { period: periodKey(now), counters: {} };
  }
  return state;
}
