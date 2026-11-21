import { listProjects } from '@/lib/storage';
import { requireSupabase, supabase } from '@/lib/supabase';
import { logCaught } from '@/lib/logCaught';
import type { ChatPeer, Conversation, ConversationRow } from '@/lib/chatCore/model';
import { resolvePeers } from '@/lib/chatClient/peers';
import { currentUserId } from '@/lib/chatClient/session';

// ── inbox: a beszélgetéseim ────────────────────────────────────────────────
/** A beszélgetéseim, legutóbbi elöl, olvasatlan-jelzéssel + DM-partnerrel. */
export async function listConversations(): Promise<Conversation[]> {
  const sb = supabase;
  const uid = currentUserId();
  if (!sb || !uid) {
    return [];
  }
  // a saját tagságom (last_read_at az olvasatlansághoz)
  const { data: memberRows } = await sb
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', uid);
  const lastRead = new Map<string, string>();
  (memberRows ?? []).forEach((m: { conversation_id: string; last_read_at: string }) =>
    lastRead.set(m.conversation_id, m.last_read_at)
  );

  const { data: convRows } = await sb
    .from('conversations')
    .select('id, kind, owner_id, project_id, title, last_message_at, last_message_preview, last_sender_id')
    .order('last_message_at', { ascending: false });
  const rows = (convRows ?? []) as ConversationRow[];
  if (rows.length === 0) {
    return [];
  }

  // a TÖBBI tag beszélgetésenként (DM: az egyetlen partner; csoport: a résztvevők)
  const directIds = rows.filter((r) => r.kind === 'dm' || r.kind === 'group').map((r) => r.id);
  const othersByConv = new Map<string, string[]>();
  if (directIds.length > 0) {
    const { data: others } = await sb
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', directIds)
      .neq('user_id', uid);
    (others ?? []).forEach((m: { conversation_id: string; user_id: string }) => {
      const arr = othersByConv.get(m.conversation_id) ?? [];
      arr.push(m.user_id);
      othersByConv.set(m.conversation_id, arr);
    });
  }
  const peers = await resolvePeers([...othersByConv.values()].flat());
  // 🏷️ projekt-chat neve: több projekt-csevegés ne legyen mind „Projekt-csevegés"
  const projectNames = await resolveProjectNames(
    rows.filter((r) => r.kind === 'project' && r.project_id).map((r) => r.project_id as string)
  );
  const peerOf = (id: string): ChatPeer => peers.get(id) ?? { id, name: null, avatar: null };

  return rows.map((r) => {
    const read = lastRead.get(r.id);
    const hasUnread =
      r.last_sender_id != null &&
      r.last_sender_id !== uid &&
      (!read || new Date(r.last_message_at).getTime() > new Date(read).getTime());
    const others = othersByConv.get(r.id) ?? [];
    return {
      id: r.id,
      kind: r.kind,
      ownerId: r.owner_id ?? undefined,
      projectId: r.project_id ?? undefined,
      title: r.title ?? undefined,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastSenderId: r.last_sender_id,
      peer: r.kind === 'dm' && others[0] ? peerOf(others[0]) : undefined,
      members: r.kind === 'group' ? others.map(peerOf) : undefined,
      projectName: r.project_id ? projectNames.get(r.project_id) : undefined,
      hasUnread,
    };
  });
}

/**
 * Projekt-id → név: előbb a felhő (`cloud_projects`, a tag olvashatja — RLS), a
 * hiányzókra a helyi projektlista. Best-effort: hiba esetén üres térkép (a hívó
 * a „Projekt-csevegés" általános címre esik vissza).
 */
async function resolveProjectNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return out;
  }
  try {
    const { data } = await requireSupabase()
      .from('cloud_projects')
      .select('project_id, name')
      .in('project_id', unique);
    (data ?? []).forEach((r: { project_id: string; name: string | null }) => {
      if (r.name) {
        out.set(r.project_id, r.name);
      }
    });
  } catch (caught) {
    logCaught('lib/chat.ts:resolveProjectNames', caught);
    // offline / nincs jog → a helyi lista pótolja
  }
  if (out.size < unique.length) {
    try {
      (await listProjects()).forEach((m) => {
        if (unique.includes(m.id) && !out.has(m.id)) {
          out.set(m.id, m.name);
        }
      });
    } catch (caught) {
      logCaught('lib/chat.ts:resolveProjectNames', caught);
      // nincs helyi tár (teszt/web) → marad, ami van
    }
  }
  return out;
}

/** Egyetlen beszélgetés fejléce (pl. értesítésből/deep-linkből nyitva). */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const list = await listConversations();
  return list.find((c) => c.id === conversationId) ?? null;
}
