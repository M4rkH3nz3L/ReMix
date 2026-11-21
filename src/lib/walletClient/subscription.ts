import { refreshEntitlement } from '@/lib/billing';
import type { AddonId } from '@/lib/subscriptionPlan';
import type { Tier } from '@/lib/tiers';
import { InsufficientCreditsError, MinorLimitError } from '@/lib/shop';
import { requireSupabase, supabase } from '@/lib/supabase';
import { logCaught } from '@/lib/logCaught';
import { AddonNotAllowedError, ManagedByStoreError } from '@/lib/walletCore/errors';
import { parseSubscription, type MySubscription } from '@/lib/walletCore/subscription';
import { currentUid } from '@/lib/walletClient/session';

/**
 * Előfizetés Coinból: havi (1) vagy éves (12 = 10 havi díj). Kevés Coin →
 * InsufficientCreditsError. Siker után szinkronizálja a jogosultságot.
 */
export async function subscribeWithCoins(
  tier: Exclude<Tier, 'free'>,
  months: 1 | 12,
  seats = 1
): Promise<{ balance: number; until: string; kind: 'start' | 'extend' | 'change' | 'downgrade'; cost: number; credit: number }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('subscribe_with_coins', { p_tier: tier, p_months: months, p_seats: seats });
  if (error) {
    if (/minor_monthly_limit/.test(error.message)) {
      throw new MinorLimitError();
    }
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    if (/managed_by_store/.test(error.message)) {
      throw new ManagedByStoreError();
    }
    throw new Error(error.message);
  }
  await refreshEntitlement().catch((caught) => { logCaught('lib/wallet.ts:subscribeWithCoins', caught); });
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    balance: Number(d.balance ?? 0),
    until: String(d.until ?? ''),
    kind: String(d.kind ?? 'start') as 'start' | 'extend' | 'change' | 'downgrade',
    cost: Number(d.cost ?? 0),
    credit: Number(d.credit ?? 0),
  };
}

export async function fetchSubscription(): Promise<MySubscription | null> {
  if (!supabase || !currentUid()) {
    return null;
  }
  const { data, error } = await supabase.rpc('my_subscription');
  if (error) {
    throw new Error(error.message);
  }
  return parseSubscription(data);
}

/** Automatikus megújítás be/ki (lemondás egy koppintással; a periódus végéig marad). */
export async function setAutoRenew(on: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('set_auto_renew', { p_on: on });
  if (error) {
    throw new Error(error.message);
  }
}

/** Add-on felvétele: a periódus hátralévő részét most időarányosan fizeted. */
export async function addAddon(addon: AddonId, qty = 1): Promise<{ cost: number; renewalCost: number; balance: number }> {
  const { data, error } = await requireSupabase().rpc('add_addon', { p_addon: addon, p_qty: qty });
  if (error) {
    if (/minor_monthly_limit/.test(error.message)) {
      throw new MinorLimitError();
    }
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    const m = /paid_tier_required|tier_too_low|addon_requires_coin_billing/.exec(error.message);
    if (m) {
      throw new AddonNotAllowedError(m[0]);
    }
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return { cost: Number(d.cost ?? 0), renewalCost: Number(d.renewal_cost ?? 0), balance: Number(d.balance ?? 0) };
}

/** Add-on levétele a következő ciklustól. */
export async function removeAddon(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('remove_addon', { p_id: id });
  if (error) {
    throw new Error(error.message);
  }
}

/** 7 napos Amatőr-próba indítása (kártya és Coin nélkül, fiókonként egyszer, PRO-CASH 4.4). */
export async function startTrial(): Promise<{ until: string }> {
  const { data, error } = await requireSupabase().rpc('start_trial');
  if (error) {
    throw new Error(/trial_used|already_subscribed/.exec(error.message)?.[0] ?? error.message);
  }
  await refreshEntitlement().catch((caught) => { logCaught('lib/wallet.ts:startTrial', caught); });
  return { until: String((data as Record<string, unknown> | null)?.until ?? '') };
}
