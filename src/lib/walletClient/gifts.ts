import { InsufficientCreditsError, MinorLimitError } from '@/lib/shop';
import { requireSupabase, supabase } from '@/lib/supabase';
import { GiftNotFoundError, RecipientNotFoundError, SelfSendError } from '@/lib/walletCore/errors';
import type { Gift, GiftEvent } from '@/lib/walletCore/types';
import { currentUid } from '@/lib/walletClient/session';

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
