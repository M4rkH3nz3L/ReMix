import type { Tier } from '@/lib/tiers';

/**
 * 🏪 Áruházi termék-azonosítók (App Store / Play / RevenueCat) — tiszta mag (PRO-CASH C0.5).
 *
 * Előfizetés: `remix_<basic|pro|ultra>_<monthly|annual>` — a RevenueCat-entitlement neve a
 * szint azonosítója (`basic` / `pro` / `ultra`). Coin-csomag: `coins_<n>` (lásd coins.ts
 * COIN_PACKS). A worker tükre: server/rcEvents.js (a contract.test.ts zárolja).
 * A Vállalati nem áruházi termék (szervezeti szerződés).
 */

export type StoreTier = Extract<Tier, 'basic' | 'pro' | 'ultra'>;
export type BillingPeriod = 'monthly' | 'annual';

export const STORE_TIERS: readonly StoreTier[] = ['basic', 'pro', 'ultra'];

/** Áruházi ár euróban (PRO-CASH 3.2): a havidíj Coinban + az áruházi jutalék fedezete. */
export const STORE_PRICE_EUR: Record<StoreTier, Record<BillingPeriod, number>> = {
  basic: { monthly: 11.99, annual: 119.99 },
  pro: { monthly: 23.99, annual: 239.99 },
  ultra: { monthly: 47.99, annual: 479.99 },
};

export function storeProductId(tier: StoreTier, period: BillingPeriod): string {
  return `remix_${tier}_${period}`;
}

/** A termék-azonosítóból a szint és a periódus, vagy null, ha nem a mi előfizetésünk. */
export function parseStoreProductId(id: string): { tier: StoreTier; period: BillingPeriod } | null {
  const m = /^remix_(basic|pro|ultra)_(monthly|annual)$/.exec(id);
  return m ? { tier: m[1] as StoreTier, period: m[2] as BillingPeriod } : null;
}

/**
 * Az aktív RevenueCat-entitlementek közül a legmagasabb szint (optimista kliens-kijelzéshez;
 * a hiteles szintet a webhook írja). `active`: a customerInfo.entitlements.active.
 */
export function highestActiveEntitlement(
  active: Record<string, { isActive?: boolean; expirationDate?: string | null }> | null | undefined
): { tier: StoreTier; expirationDate: string | null } | null {
  for (const tier of [...STORE_TIERS].reverse()) {
    const ent = active?.[tier];
    if (ent?.isActive) {
      return { tier, expirationDate: ent.expirationDate ?? null };
    }
  }
  return null;
}
