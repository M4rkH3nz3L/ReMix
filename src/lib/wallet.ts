import { cloudBaseUrl } from '@/lib/backend';
import { refreshEntitlement } from '@/lib/billing';
import { EMPTY_WALLET, parseWallet, type WalletBreakdown } from '@/lib/coins';
import type { Tier } from '@/lib/tiers';
import { InsufficientCreditsError } from '@/lib/shop';
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
  provider: 'paypal' | 'stripe';
  email: string | null;
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
): Promise<{ balance: number; until: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('subscribe_with_coins', { p_tier: tier, p_months: months, p_seats: seats });
  if (error) {
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }
  await refreshEntitlement().catch((caught) => { logCaught('lib/wallet.ts:subscribeWithCoins', caught); });
  const d = (data ?? {}) as Record<string, unknown>;
  return { balance: Number(d.balance ?? 0), until: String(d.until ?? '') };
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
    .select('provider, email')
    .eq('user_id', uid)
    .maybeSingle();
  return data ? (data as PayoutAccount) : null;
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
