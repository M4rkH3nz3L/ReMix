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

/**
 * A blokkolt szerzők elemeit elrejti — a block kiterjesztése a FEED/KOMMENT szintre
 * (kliens-oldali szűrés; a szerver-RLS a messaging-et már védi). Üres blokk-lista →
 * változatlan (ugyanaz a sorrend). Genericus: a hívó adja az „ki a szerző" függvényt.
 */
export function filterBlocked<T>(
  items: readonly T[],
  getAuthorId: (item: T) => string,
  blockedIds: readonly string[],
): T[] {
  if (blockedIds.length === 0) {
    return [...items];
  }
  const set = new Set(blockedIds);
  return items.filter((item) => !set.has(getAuthorId(item)));
}

/**
 * „Restrict" (lágy tiltás, Instagram-stílus): ha a tartalom tulajdonosa KORLÁTOZ egy
 * szerzőt, annak kommentje CSAK a saját maga + a tulajdonos számára látszik (a többi
 * nézőnek rejtve, amíg a tulaj nem hagyja jóvá). A nem-korlátozott szerzőt mindenki látja.
 */
export function isCommentVisible(
  commentAuthorId: string,
  viewerId: string | null,
  ownerId: string,
  restrictedIds: readonly string[],
): boolean {
  if (!restrictedIds.includes(commentAuthorId)) {
    return true;
  }
  return viewerId === commentAuthorId || viewerId === ownerId;
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

// ── Restrict (lágy tiltás) CRUD ──────────────────────────────────────────────

/** Korlátozom ezt a usert: a kommentjei csak neki + nekem látszanak (`isCommentVisible`). */
export async function restrictUser(otherId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  if (me === otherId) {
    throw new Error('Magadat nem korlátozhatod.');
  }
  const { error } = await sb
    .from('restricted_users')
    .insert({ restricter_id: me, restricted_id: otherId });
  if (error && !/duplicate|unique|conflict/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function unrestrictUser(otherId: string): Promise<void> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { error } = await sb
    .from('restricted_users')
    .delete()
    .eq('restricter_id', me)
    .eq('restricted_id', otherId);
  if (error) {
    throw new Error(error.message);
  }
}

/** A saját korlátozott user-id-im (a komment-szűréshez `isCommentVisible`-lel). */
export async function listMyRestrictedIds(): Promise<string[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase.from('restricted_users').select('restricted_id');
  return (data ?? []).map((r) => r.restricted_id as string);
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
