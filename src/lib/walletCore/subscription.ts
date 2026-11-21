import type { AddonId } from '@/lib/subscriptionPlan';
import { asTier, type Tier } from '@/lib/tiers';

/** Az előfizetésem (a DB `my_subscription()` válasza). */
export interface MySubscription {
  tier: Tier;
  status: string;
  source: string;
  seats: number;
  billingPeriod: 'month' | 'year';
  until: string | null;
  autoRenew: boolean;
  pendingTier: Tier | null;
  /** a következő megújítás díja cent-Coinban (szint + megmaradó add-onok) */
  renewalCost: number;
  /** indítható-e még a 7 napos próba (Free, és még nem használta) */
  trialAvailable: boolean;
  addons: { id: string; addon: AddonId; qty: number; cancelAtPeriodEnd: boolean }[];
}

export function parseSubscription(raw: unknown): MySubscription {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const addons = Array.isArray(r.addons) ? (r.addons as Record<string, unknown>[]) : [];
  return {
    tier: asTier(r.tier),
    status: String(r.status ?? 'active'),
    source: String(r.source ?? 'manual'),
    seats: Number(r.seats ?? 1) || 1,
    billingPeriod: r.billing_period === 'year' ? 'year' : 'month',
    until: typeof r.until === 'string' ? r.until : null,
    autoRenew: r.auto_renew === true,
    pendingTier: typeof r.pending_tier === 'string' ? asTier(r.pending_tier) : null,
    renewalCost: Number(r.renewal_cost ?? 0) || 0,
    trialAvailable: r.trial_available === true,
    addons: addons.map((a) => ({
      id: String(a.id),
      addon: String(a.addon) as AddonId,
      qty: Number(a.qty ?? 1) || 1,
      cancelAtPeriodEnd: a.cancel_at_period_end === true,
    })),
  };
}
