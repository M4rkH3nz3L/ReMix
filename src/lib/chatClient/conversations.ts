import { requireSupabase, supabase } from '@/lib/supabase';

// ── beszélgetés megnyitása/létrehozása ─────────────────────────────────────
/** DM megnyitása/létrehozása egy másik userrel → a beszélgetés id-ja. */
export async function openDm(otherUserId: string): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('get_or_create_dm', { p_other: otherUserId });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

/** Projekt-beszélgetés (collab-chat) megnyitása/létrehozása — csak projekt-tagnak. */
export async function openProjectConversation(ownerId: string, projectId: string): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('get_or_create_project_conversation', {
    p_owner: ownerId,
    p_project: projectId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

// ── csoport (group DM) ──────────────────────────────────────────────────────
/** Csoport létrehozása (név + kezdő tagok) → a beszélgetés id-ja. */
export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_group_conversation', {
    p_title: title.trim(),
    p_members: memberIds,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

/** Tag hozzáadása egy csoporthoz (csak meglévő tag adhat hozzá). */
export async function addGroupMember(conversationId: string, userId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('add_group_member', { p_conv: conversationId, p_user: userId });
  if (error) {
    throw new Error(error.message);
  }
}

/** Kilépés a beszélgetésből (a saját tagságom törlése — csoportnál „elhagyom"). */
export async function leaveConversation(conversationId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('leave_conversation', { p_conv: conversationId });
  if (error) {
    throw new Error(error.message);
  }
}

/** Csoport átnevezése (csak tag). */
export async function renameGroup(conversationId: string, title: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('rename_group', { p_conv: conversationId, p_title: title.trim() });
  if (error) {
    throw new Error(error.message);
  }
}

/** A beszélgetés olvasottra állítása (a saját last_read_at → most). */
export async function markRead(conversationId: string): Promise<void> {
  const sb = supabase;
  if (!sb) {
    return;
  }
  await sb.rpc('mark_conversation_read', { p_conv: conversationId });
}
