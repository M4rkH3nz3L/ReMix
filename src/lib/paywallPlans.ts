import { CAPABILITIES, type CapabilityId } from '@/lib/capabilities';
import { TIER_PRICE_CENTS, centsToCoins } from '@/lib/coins';
import { ENTITLEMENTS } from '@/lib/entitlements';
import { STORE_PRICE_EUR, type BillingPeriod } from '@/lib/storeProducts';
import { periodPriceCents } from '@/lib/subscriptionPlan';
import { TIER_ORDER, tierRank, type Tier } from '@/lib/tiers';
import { TIER_QUOTAS } from '@/lib/usageMeter';

/**
 * 💳 Paywall v2 modell — tiszta mag (PRO-CASH 3.1, 4.4, C1.4).
 *
 * Az összehasonlító tábla minden cellája a meglévő EGY forrásból jön (ENTITLEMENTS,
 * TIER_QUOTAS, TIER_PRICE_CENTS, STORE_PRICE_EUR) — a paywall nem tarthat saját számokat,
 * különben elcsúszna a valós kaputól. A felület (PaywallSheet) csak megjeleníti.
 */

export type PlanCell = { kind: 'text'; key: string; params?: Record<string, string | number> } | { kind: 'bool'; value: boolean };

export interface PlanRow {
  /** i18n-kulcs a sor nevéhez (paywallSheet.row.*) */
  label: string;
  cells: Record<Tier, PlanCell>;
}

const txt = (key: string, params?: Record<string, string | number>): PlanCell => ({ kind: 'text', key, params });
const bool = (value: boolean): PlanCell => ({ kind: 'bool', value });

function perTier(fn: (t: Tier) => PlanCell): Record<Tier, PlanCell> {
  return Object.fromEntries(TIER_ORDER.map((t) => [t, fn(t)])) as Record<Tier, PlanCell>;
}

/** Ezres egységű szám rövid formája (200 000 → „200 ezer”, 3 000 000 → „3 M”). */
export function compactAmount(n: number): { key: string; n: number } {
  if (n >= 1000000) {
    return { key: 'paywallSheet.amount.million', n: n / 1000000 };
  }
  if (n >= 1000) {
    return { key: 'paywallSheet.amount.thousand', n: n / 1000 };
  }
  return { key: 'paywallSheet.amount.plain', n };
}

/** A szint ára az adott periódusban: Coinban (a legolcsóbb út) és áruházi euróban. */
export function planPrice(tier: Tier, period: BillingPeriod): { coins: number; storeEur: number | null } {
  if (tier === 'free') {
    return { coins: 0, storeEur: 0 };
  }
  const coins = centsToCoins(periodPriceCents(tier, period === 'annual' ? 'year' : 'month', tier === 'business' ? 2 : 1));
  const storeEur = tier === 'business' ? null : STORE_PRICE_EUR[tier][period];
  return { coins: tier === 'business' ? coins / 2 : coins, storeEur };
}

/** Az összehasonlító tábla sorai (PRO-CASH 3.1). */
export function planRows(): PlanRow[] {
  const q = TIER_QUOTAS;
  return [
    {
      label: 'paywallSheet.row.price',
      cells: perTier((t) =>
        t === 'free'
          ? txt('paywallSheet.cell.free')
          : t === 'business'
            ? txt('paywallSheet.cell.perSeat', { coins: centsToCoins(TIER_PRICE_CENTS[t]) })
            : txt('paywallSheet.cell.coinsMonth', { coins: centsToCoins(TIER_PRICE_CENTS[t]) })
      ),
    },
    { label: 'paywallSheet.row.ads', cells: perTier((t) => bool(t !== 'free')) },
    { label: 'paywallSheet.row.watermark', cells: perTier((t) => bool(!ENTITLEMENTS[t].watermark)) },
    {
      label: 'paywallSheet.row.cloudStorage',
      cells: perTier((t) =>
        ENTITLEMENTS[t].storageQuotaGB > 0
          ? txt(t === 'business' ? 'paywallSheet.cell.gbPerSeat' : 'paywallSheet.cell.gb', { gb: ENTITLEMENTS[t].storageQuotaGB })
          : txt('paywallSheet.cell.ownCloud')
      ),
    },
    {
      label: 'paywallSheet.row.ai',
      cells: perTier((t) => {
        if (q[t].aiTokens === 0) {
          return txt('paywallSheet.cell.onDeviceAi');
        }
        const c = compactAmount(q[t].aiTokens);
        return txt(c.key, { n: c.n });
      }),
    },
    {
      label: 'paywallSheet.row.cloudRender',
      cells: perTier((t) =>
        q[t].renderMinutes === 0 ? txt('paywallSheet.cell.onPhone') : txt('paywallSheet.cell.minutes', { n: q[t].renderMinutes })
      ),
    },
    {
      label: 'paywallSheet.row.maxRes',
      cells: perTier((t) => txt('paywallSheet.cell.res', { p: ENTITLEMENTS[t].renderMaxRes === 2160 ? '4K' : `${ENTITLEMENTS[t].renderMaxRes}p` })),
    },
    {
      label: 'paywallSheet.row.publish',
      cells: perTier((t) => {
        const n = ENTITLEMENTS[t].publishMaxAccounts;
        return n < 0 ? txt('paywallSheet.cell.unlimited') : n === 0 ? bool(false) : txt('paywallSheet.cell.count', { n });
      }),
    },
    { label: 'paywallSheet.row.team', cells: perTier((t) => bool(ENTITLEMENTS[t].rbac)) },
    { label: 'paywallSheet.row.addons', cells: perTier((t) => bool(t !== 'free')) },
  ];
}

/**
 * Melyik szintet emeljük ki: a kiváltó képesség minimum-szintjét (ha van), különben az
 * Amatőrt (a legerősebb „miért fizessek” lépcső, PRO-CASH 3.1). A Vállalatit nem ajánljuk
 * fel automatikusan (cégellenőrzés kell).
 */
export function recommendedTier(capability: CapabilityId | null | undefined): Exclude<Tier, 'free' | 'business'> {
  const min = capability ? CAPABILITIES[capability]?.minTier : undefined;
  if (!min || min === 'free' || min === 'basic') {
    return 'basic';
  }
  return tierRank(min) >= tierRank('ultra') ? 'ultra' : 'pro';
}

/** Az éves fizetés megtakarítása hónapokban (10 havi díj 12 hónapért). */
export const ANNUAL_FREE_MONTHS = 2;
