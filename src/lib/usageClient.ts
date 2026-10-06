import { requireSupabase } from '@/lib/supabase';
import { periodKey, quotaFor, remaining, usageRatio, type UsageCounters, type UsageMetric } from '@/lib/usageMeter';
import type { Tier } from '@/lib/tiers';

/**
 * 📊 Usage-metering kliens-olvasás (audit §2.2). A bejelentkezett user AKTUÁLIS havi
 * felhasználása a `usage_counters`-ből (RLS: csak a sajátját látja). A kvóta-ENFORCE
 * server-oldali (a worker `enforceQuota`-ja); ez a kliens a megjelenítéshez/soft-warnhoz
 * olvas, a [usageMeter.ts](./usageMeter.ts) hiteles logikájával számolva.
 */

/** A user aktuális havi számlálói (üres objektum, ha nincs/hiba). */
export async function fetchMyUsage(now: Date = new Date()): Promise<UsageCounters> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('usage_counters')
    .select('metric, amount')
    .eq('period', periodKey(now));
  if (error) {
    throw new Error(error.message);
  }
  const out: UsageCounters = {};
  for (const r of (data ?? []) as { metric: string; amount: number }[]) {
    out[r.metric as UsageMetric] = Number(r.amount) || 0;
  }
  return out;
}

export interface MetricStatus {
  metric: UsageMetric;
  used: number;
  /** -1 = korlátlan */
  limit: number;
  remaining: number;
  /** 0–1 (0, ha korlátlan) */
  ratio: number;
}

/** A felhasználás + kvóta státusza metrikánként a megadott szinten (UI-progress/warn). */
export function usageStatus(counters: UsageCounters, tier: Tier): MetricStatus[] {
  const quota = quotaFor(tier);
  return (Object.keys(quota) as UsageMetric[]).map((metric) => ({
    metric,
    used: counters[metric] ?? 0,
    limit: quota[metric],
    remaining: remaining(counters, quota, metric),
    ratio: usageRatio(counters, quota, metric),
  }));
}

/** Van-e olyan metrika, ami a `warnAt` arányt (default 0.8) elérte → soft-warn. */
export function nearQuota(counters: UsageCounters, tier: Tier, warnAt = 0.8): MetricStatus[] {
  return usageStatus(counters, tier).filter((s) => s.limit >= 0 && s.ratio >= warnAt);
}
