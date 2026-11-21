import { cloudBaseUrl } from '@/lib/backend';
import { requireSupabase, supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { logCaught } from '@/lib/logCaught';
import {
  BelowMinPayoutError,
  InsufficientEarnedError,
  KycRequiredError,
  NoPayoutAccountError,
  PayoutWeeklyLimitError,
} from '@/lib/walletCore/errors';
import type { PayoutAccount, PayoutRequest, PayoutReviewRow } from '@/lib/walletCore/types';
import { currentUid } from '@/lib/walletClient/session';

/** A kifizetési célszámlám (PayPal e-mail), vagy null. */
export async function fetchPayoutAccount(): Promise<PayoutAccount | null> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return null;
  }
  const { data } = await supabase
    .from('payout_accounts')
    .select('provider, email, kyc_status')
    .eq('user_id', uid)
    .maybeSingle();
  if (!data) {
    return null;
  }
  const d = data as { provider: PayoutAccount['provider']; email: string | null; kyc_status?: string };
  const kyc = d.kyc_status === 'pending' || d.kyc_status === 'verified' || d.kyc_status === 'rejected' ? d.kyc_status : 'none';
  return { provider: d.provider, email: d.email, kycStatus: kyc };
}

/** A kifizetési célszámla beállítása (PayPal e-mail). */
export async function setPayoutAccount(email: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('set_payout_account', { p_provider: 'paypal', p_email: email });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Megkeresett Coin beváltása (1 Coin = 3 €) a worker `/wallet/payout`-ján: levon + provider-
 * utalás (PayPal). Provider nélkül a kérelem 'pending' marad. `cents`: cent-Coin.
 */
export async function requestPayout(
  cents: number
): Promise<{ status: string; balance: number; amountEurCents: number }> {
  const res = await fetch(`${cloudBaseUrl()}/wallet/payout`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ cents }),
  });
  const body = (await res.json().catch((caught) => { logCaught('lib/wallet.ts:requestPayout', caught); return {}; })) as {
    error?: string;
    status?: string;
    balance?: number;
    amount_eur_cents?: number;
  };
  if (!res.ok) {
    if (body.error === 'no_payout_account') {
      throw new NoPayoutAccountError();
    }
    if (body.error === 'insufficient_earned') {
      throw new InsufficientEarnedError();
    }
    if (body.error === 'below_min_payout') {
      throw new BelowMinPayoutError();
    }
    if (body.error === 'payout_weekly_limit') {
      throw new PayoutWeeklyLimitError();
    }
    if (body.error === 'kyc_required') {
      throw new KycRequiredError();
    }
    if (body.error === 'minor_no_payout') {
      throw new Error('minor_no_payout');
    }
    throw new Error(body.error || 'payout_failed');
  }
  return {
    status: String(body.status ?? 'pending'),
    balance: Number(body.balance ?? 0),
    amountEurCents: Number(body.amount_eur_cents ?? 0),
  };
}

/** A kifizetési kérelmeim (státusszal). */
export async function myPayoutRequests(limit = 10): Promise<PayoutRequest[]> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('payout_requests')
    .select('id, cents, amount_eur_cents, status, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    cents: Number(r.cents ?? 0),
    amountEurCents: Number(r.amount_eur_cents ?? 0),
    status: String(r.status ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));
}

/** 🪪 Azonosítás (KYC) a Stripe Connecttel: az onboarding-oldal címe. Az eredményt a Stripe webhook írja. */
export async function startStripeKyc(): Promise<string> {
  const res = await fetch(`${cloudBaseUrl()}/wallet/kyc/stripe`, { method: 'POST', headers: await workerJsonHeaders(), body: '{}' });
  const body = (await res.json().catch((caught) => { logCaught('lib/wallet.ts:startStripeKyc', caught); return {}; })) as { url?: string; error?: string };
  if (!res.ok || !body.url) {
    throw new Error(body.error || 'kyc_failed');
  }
  return body.url;
}

export async function listPayoutsUnderReview(): Promise<PayoutReviewRow[]> {
  const { data, error } = await requireSupabase().rpc('payouts_under_review');
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    username: (r.username as string | null) ?? null,
    cents: Number(r.cents ?? 0),
    amountEurCents: Number(r.amount_eur_cents ?? 0),
    riskFlags: Array.isArray(r.risk_flags) ? (r.risk_flags as string[]) : [],
    createdAt: String(r.created_at ?? ''),
  }));
}

/** Jóváhagyás / elutasítás (a saját kérését senki nem bírálhatja el; a DB dönt). */
export async function reviewPayout(id: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await requireSupabase().rpc('review_payout', { p_request: id, p_approve: approve, p_note: note ?? null });
  if (error) {
    throw new Error(error.message);
  }
}
