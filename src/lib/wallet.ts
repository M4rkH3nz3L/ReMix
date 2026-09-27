import { cloudBaseUrl } from '@/lib/backend';
import { refreshEntitlement } from '@/lib/billing';
import { InsufficientCreditsError } from '@/lib/shop';
import { requireSupabase, supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { useAuth } from '@/store/authStore';

/**
 * 🪙 Koin-pénztárca — a pénzkeresés alaprendszere.
 *
 * Ráták: 1 koin = 5 Ft VÉTELÁRON, 1 koin = 3 Ft KIVÁLTÁSKOR (a platform a
 * különbözetet tartja). A Pro koinnal is fizethető (500 koin / hó). Minden
 * pénzmozgás SZERVER-HITELES: a levonás/jóváírás SECURITY DEFINER RPC-ken megy
 * (`subscribe_pro_with_credits`, `send_credits`), a kifizetés a worker
 * `/wallet/payout`-ján (levon + provider-utalás). Lásd `@/lib/shop` (egyenleg).
 */

export const COIN_BUY_HUF = 5; // 1 koin vételára
export const COIN_CASHOUT_HUF = 3; // 1 koin kiváltási értéke
export const CURRENCY = 'Ft';
export const PRO_MONTHLY_COINS = 500; // Pro / hó koinban
export const MIN_PAYOUT_COINS = 100; // minimum kiváltható koin

export interface CreditTx {
  id: string;
  delta: number;
  kind: string;
  note: string | null;
  createdAt: string;
}

export interface PayoutRequest {
  id: string;
  coins: number;
  amountHuf: number;
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
  costCoins: number;
}

export interface GiftEvent {
  id: string;
  giftId: string;
  coins: number;
  createdAt: string;
}

/** Címzett nem található (send_credits). */
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
/** A kiváltandó koin a minimum alatt van. */
export class BelowMinPayoutError extends Error {
  constructor() {
    super('below_min_payout');
    this.name = 'BelowMinPayoutError';
  }
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/**
 * Pro előfizetés fizetése KOINNAL (500 koin / hó). Kevés kredit →
 * InsufficientCreditsError. Sikeres aktiválás után szinkronizálja a jogosultságot.
 */
export async function subscribeProWithCredits(
  months: number
): Promise<{ balance: number; proUntil: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('subscribe_pro_with_credits', { p_months: months });
  if (error) {
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }
  await refreshEntitlement().catch(() => {});
  const d = (data ?? {}) as Record<string, unknown>;
  return { balance: Number(d.balance ?? 0), proUntil: String(d.pro_until ?? '') };
}

/** Az ajándék-katalógus (TikTok-modell): fix koin-áras tételek. */
export async function listGifts(): Promise<Gift[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase
    .from('gifts')
    .select('id, name, icon, cost_coins')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    icon: String(r.icon ?? '🎁'),
    costCoins: Number(r.cost_coins ?? 0),
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
): Promise<{ balance: number; coins: number }> {
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
  return { balance: Number(d.balance ?? 0), coins: Number(d.coins ?? 0) };
}

/** A nekem küldött ajándékok (bevétel-kijelzés). */
export async function receivedGifts(limit = 10): Promise<GiftEvent[]> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('gift_events')
    .select('id, gift_id, coins, created_at')
    .eq('to_user', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    giftId: String(r.gift_id ?? ''),
    coins: Number(r.coins ?? 0),
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
 * Koin kiváltása pénzre (3 Ft/koin) a worker `/wallet/payout`-ján: levon + provider-
 * utalás (PayPal). Provider nélkül a kérelem 'pending' marad. Visszaadja a státuszt
 * + az egyenleget.
 */
export async function requestPayout(
  coins: number
): Promise<{ status: string; balance: number; amountHuf: number }> {
  const res = await fetch(`${cloudBaseUrl()}/wallet/payout`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ coins }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    status?: string;
    balance?: number;
    amount_huf?: number;
  };
  if (!res.ok) {
    if (body.error === 'no_payout_account') {
      throw new NoPayoutAccountError();
    }
    if (body.error === 'insufficient_credits') {
      throw new InsufficientCreditsError();
    }
    if (body.error === 'below_min_payout') {
      throw new BelowMinPayoutError();
    }
    throw new Error(body.error || 'payout_failed');
  }
  return {
    status: String(body.status ?? 'pending'),
    balance: Number(body.balance ?? 0),
    amountHuf: Number(body.amount_huf ?? 0),
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
    .select('id, delta, kind, note, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    delta: Number(r.delta ?? 0),
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
    .select('id, coins, amount_huf, status, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    coins: Number(r.coins ?? 0),
    amountHuf: Number(r.amount_huf ?? 0),
    status: String(r.status ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));
}
