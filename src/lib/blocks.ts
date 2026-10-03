import { currentUserId } from '@/lib/chat';
import { requireSupabase, supabase } from '@/lib/supabase';

/**
 * 🧱 Letiltás (block) + némítás (mute) — messaging safety (devs/tasks/remix/10).
 *
 * A tényleges ENFORCEMENT a szerveren van (RLS): a `messages_not_from_blocked`
 * policy a blokkolt feladótól nem enged üzenetet. Ez a kliens-réteg a SAJÁT
 * blokk-/némítás-listát kezeli (RLS: `blocker_id`/`user_id = auth.uid()`), és a
 * tiszta döntés-függvények a UI-nak (kit rejtsünk/tiltsunk a saját oldalunkon).
 *
 * Megjegyzés: a kliens CSAK a SAJÁT blokkjait látja (más blokkjait az RLS rejti);
 * a „ő tiltott le engem" eset a szerver-RLS-en át jelenik meg (üzenet-küldés hiba).
 */

// ── PURE döntés-függvények (tesztelhetők) ────────────────────────────────────

/** Én letiltottam-e ezt a usert? (a saját blokk-listámból) */
export function isBlockedByMe(myBlockedIds: readonly string[], otherId: string): boolean {
  return !!otherId && myBlockedIds.includes(otherId);
}

/** Némítottam-e ezt a beszélgetést? */
export function isMuted(myMutedConvIds: readonly string[], conversationId: string): boolean {
  return !!conversationId && myMutedConvIds.includes(conversationId);
}

// ── Supabase CRUD ────────────────────────────────────────────────────────────

export async function blockUser(otherId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  if (me === otherId) {
    throw new Error('Magadat nem tilthatod le.');
  }
  const { error } = await sb.from('user_blocks').insert({ blocker_id: me, blocked_id: otherId });
  // a duplikált blokk (már letiltva) nem hiba
  if (error && !/duplicate|unique|conflict/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function unblockUser(otherId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { error } = await sb
    .from('user_blocks')
    .delete()
    .eq('blocker_id', me)
    .eq('blocked_id', otherId);
  if (error) {
    throw new Error(error.message);
  }
}

/** A saját letiltott user-id-im. */
export async function listMyBlockedIds(): Promise<string[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase.from('user_blocks').select('blocked_id');
  return (data ?? []).map((r) => r.blocked_id as string);
}

export async function muteConversation(conversationId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { error } = await sb
    .from('conversation_mutes')
    .insert({ user_id: me, conversation_id: conversationId });
  if (error && !/duplicate|unique|conflict/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function unmuteConversation(conversationId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { error } = await sb
    .from('conversation_mutes')
    .delete()
    .eq('user_id', me)
    .eq('conversation_id', conversationId);
  if (error) {
    throw new Error(error.message);
  }
}

/** A saját némított beszélgetés-id-im. */
export async function listMyMutedConvIds(): Promise<string[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase.from('conversation_mutes').select('conversation_id');
  return (data ?? []).map((r) => r.conversation_id as string);
}
