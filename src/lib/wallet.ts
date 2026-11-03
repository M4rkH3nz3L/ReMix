import { cloudBaseUrl } from '@/lib/backend';
import { refreshEntitlement } from '@/lib/billing';
import { EMPTY_WALLET, groupEarnings, parseWallet, type EarningsMonth, type WalletBreakdown } from '@/lib/coins';
import { shareFile } from '@/lib/export';
import type { AddonId } from '@/lib/subscriptionPlan';
import { asTier, type Tier } from '@/lib/tiers';
import { InsufficientCreditsError, MinorLimitError } from '@/lib/shop';
import { requireSupabase, supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { useAuth } from '@/store/authStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🪙 Coin-pénztárca kliens-réteg (PRO-CASH 2. fejezet).
 *
 * Minden összeg cent-Coinban (1 Coin = 100); az árak, díjak és a kijelzés a tiszta
 * `@/lib/coins` magban. Minden pénzmozgás SZERVER-HITELES: a terhelés/jóváírás
 * SECURITY DEFINER RPC-ken megy (`subscribe_with_coins`, `send_gift`, …), a kifizetés
 * a worker `/wallet/payout`-ján (csak a beváltható megkeresett Coinból).
 */

export interface CreditTx {
  id: string;
  /** cent-Coin (+ jóváírás / − terhelés) */
  deltaCents: number;
  /** melyik alegyenleget érintette */
  bucket: 'purchased' | 'bonus' | 'earned_pending' | 'earned_available' | null;
  kind: string;
  note: string | null;
  createdAt: string;
}

export interface PayoutRequest {
  id: string;
  cents: number;
  amountEurCents: number;
  status: string;
  createdAt: string;
}

export interface PayoutAccount {
  provider: 'paypal' | 'stripe' | null;
  email: string | null;
  /** a partner (Stripe Connect / PayPal) által végzett azonosítás állapota — kifizetés csak 'verified'-del */
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
}

export interface Gift {
  id: string;
  name: string;
  icon: string;
  costCents: number;
}

export interface GiftEvent {
  id: string;
  giftId: string;
  /** az alkotónak jóváírt rész (80%), cent-Coin */
  creatorCents: number;
  createdAt: string;
}

/** Címzett nem található. */
export class RecipientNotFoundError extends Error {
  constructor() {
    super('recipient_not_found');
    this.name = 'RecipientNotFoundError';
  }
}
/** Magadnak nem küldhetsz. */
export class SelfSendError extends Error {
  constructor() {
    super('cannot_send_to_self');
    this.name = 'SelfSendError';
  }
}
/** Ismeretlen ajándék. */
export class GiftNotFoundError extends Error {
  constructor() {
    super('gift_not_found');
    this.name = 'GiftNotFoundError';
  }
}
/** Nincs beállított kifizetési célszámla. */
export class NoPayoutAccountError extends Error {
  constructor() {
    super('no_payout_account');
    this.name = 'NoPayoutAccountError';
  }
}
/** A kiváltandó összeg a minimum (20 Coin) alatt van. */
export class BelowMinPayoutError extends Error {
  constructor() {
    super('below_min_payout');
    this.name = 'BelowMinPayoutError';
  }
}
/** Nincs ennyi BEVÁLTHATÓ megkeresett Coin (a vásárolt / függő nem váltható). */
export class InsufficientEarnedError extends Error {
  constructor() {
    super('insufficient_earned');
    this.name = 'InsufficientEarnedError';
  }
}
/** Az előfizetést az áruház kezeli (App Store / Play) — ott módosítható. */
export class ManagedByStoreError extends Error {
  constructor() {
    super('managed_by_store');
    this.name = 'ManagedByStoreError';
  }
}
/** Kifizetés előtt azonosítás (KYC) kell. */
export class KycRequiredError extends Error {
  constructor() {
    super('kyc_required');
    this.name = 'KycRequiredError';
  }
}
/** Hetente legfeljebb egy kifizetés kérhető. */
export class PayoutWeeklyLimitError extends Error {
  constructor() {
    super('payout_weekly_limit');
    this.name = 'PayoutWeeklyLimitError';
  }
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** A pénztárcám bontása (vásárolt / bónusz / függő / beváltható). A lejárt tartást a szerver feloldja. */
export async function fetchWallet(): Promise<WalletBreakdown> {
  if (!supabase || !currentUid()) {
    return EMPTY_WALLET;
  }
  const { data, error } = await supabase.rpc('my_wallet');
  if (error) {
    throw new Error(error.message);
  }
  return parseWallet(data);
}

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

/** Az ajándék-katalógus (TikTok-modell): fix koin-áras tételek. */
export async function listGifts(): Promise<Gift[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase
    .from('gifts')
    .select('id, name, icon, cost_cents')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    icon: String(r.icon ?? '🎁'),
    costCents: Number(r.cost_cents ?? 0),
  }));
}

/**
 * Ajándék küldése egy felhasználónak (username alapján). Az ár a KATALÓGUSBÓL jön
 * (szerver-hiteles). Hibák: kevés kredit, ismeretlen címzett/ajándék, önmagadnak.
 */
export async function sendGift(
  toUsername: string,
  giftId: string,
  opts?: { postId?: string | null; message?: string | null }
): Promise<{ balance: number; cost: number }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('send_gift', {
    p_to_username: toUsername,
    p_gift_id: giftId,
    p_post_id: opts?.postId ?? null,
    p_message: opts?.message ?? null,
  });
  if (error) {
    if (/minor_monthly_limit/.test(error.message)) {
      throw new MinorLimitError();
    }
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    if (/recipient_not_found/.test(error.message)) {
      throw new RecipientNotFoundError();
    }
    if (/cannot_send_to_self/.test(error.message)) {
      throw new SelfSendError();
    }
    if (/gift_not_found/.test(error.message)) {
      throw new GiftNotFoundError();
    }
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return { balance: Number(d.balance ?? 0), cost: Number(d.cost ?? 0) };
}

/** A nekem küldött ajándékok (bevétel-kijelzés). */
export async function receivedGifts(limit = 10): Promise<GiftEvent[]> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('gift_events')
    .select('id, gift_id, creator_cents, created_at')
    .eq('to_user', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    giftId: String(r.gift_id ?? ''),
    creatorCents: Number(r.creator_cents ?? 0),
    createdAt: String(r.created_at ?? ''),
  }));
}

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

/** A legutóbbi kredit-tranzakcióim (napló). */
export async function creditHistory(limit = 20): Promise<CreditTx[]> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('credit_transactions')
    .select('id, delta_cents, bucket, kind, note, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    deltaCents: Number(r.delta_cents ?? 0),
    bucket: (r.bucket as CreditTx['bucket']) ?? null,
    kind: String(r.kind ?? ''),
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }));
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

/** Az add-on nem vehető (szint / számlázás). */
export class AddonNotAllowedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AddonNotAllowedError';
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

/**
 * 💶 Webes Coin-feltöltés (Stripe Checkout, 5 € / Coin, PRO-CASH C1.5): a worker Checkout
 * Sessiont nyit, a fizetett összeget a Stripe webhook írja jóvá. Visszaadja a fizetési oldal címét.
 */
export async function startWebTopup(packId: string): Promise<string> {
  const res = await fetch(`${cloudBaseUrl()}/billing/stripe/checkout`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ packId }),
  });
  const body = (await res.json().catch((caught) => { logCaught('lib/wallet.ts:startWebTopup', caught); return {}; })) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error || 'checkout_failed');
  }
  return body.url;
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

/** Ellenőrzésre váró kifizetés (admin, `payout.review`). */
export interface PayoutReviewRow {
  id: string;
  username: string | null;
  cents: number;
  amountEurCents: number;
  riskFlags: string[];
  createdAt: string;
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

/** 🤝 Az ajánló megadása (a regisztrációt követő 7 napon belül, egyszer). */
export async function claimReferral(username: string): Promise<void> {
  const { error } = await requireSupabase().rpc('claim_referral', { p_username: username.trim().replace(/^@/, '') });
  if (error) {
    throw new Error(
      /referrer_not_found|cannot_refer_self|referral_already_set|referral_window_closed|referral_loop/.exec(error.message)?.[0] ?? error.message
    );
  }
}

/** Az általam meghívottak száma és az eddigi jutalék (cent-Coin). */
export async function myReferralStats(): Promise<{ invited: number; earnedCents: number }> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return { invited: 0, earnedCents: 0 };
  }
  const { data } = await supabase.from('referrals').select('earned_cents').eq('referrer_id', uid);
  const rows = (data ?? []) as { earned_cents: number }[];
  return { invited: rows.length, earnedCents: rows.reduce((n, r) => n + Number(r.earned_cents || 0), 0) };
}

export type { EarningsMonth };

export async function fetchEarnings(months = 6): Promise<EarningsMonth[]> {
  if (!supabase || !currentUid()) {
    return [];
  }
  const { data, error } = await supabase.rpc('my_earnings', { p_months: months });
  if (error) {
    throw new Error(error.message);
  }
  return groupEarnings(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    month: String(r.month),
    kind: String(r.kind),
    cents: Number(r.cents ?? 0),
  })));
}

/** Az éves bevételi kimutatás (CSV) letöltése / megosztása — az adóbevalláshoz. */
export async function downloadEarningsStatement(year: number): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/wallet/statement?year=${year}`, { headers: await workerJsonHeaders() });
  if (!res.ok) {
    throw new Error(`statement_failed (${res.status})`);
  }
  await shareFile(`remix-bevetel-${year}.csv`, await res.text(), 'text/csv');
}

/** DAC7-export (CSV) — `finance.manage` jogú adminnak (a szerver ellenőrzi). */
export async function downloadDac7(year: number): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/admin/dac7?year=${year}`, { headers: await workerJsonHeaders() });
  if (!res.ok) {
    throw new Error(res.status === 403 ? 'forbidden' : `dac7_failed (${res.status})`);
  }
  await shareFile(`remix-dac7-${year}.csv`, await res.text(), 'text/csv');
}
