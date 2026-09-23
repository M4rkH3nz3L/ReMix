import { reachableMediaUrl } from '@/lib/mediaUrl';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 💬 Realtime chat kliens-réteg — DM ÉS projekt-scoped (collab) beszélgetés.
 *
 * A beszélgetést a `conversations` sor hordozza, a tagságot a `conversation_members`
 * (a saját `last_read_at`-ből jön az olvasatlanság), az üzeneteket a `messages`
 * (denormalizált feladó, mint a posztnál/kommentnél — nincs cross-profil olvasás).
 * A létrehozás két SECURITY DEFINER RPC-n megy (get_or_create_dm / _project_*),
 * hogy a tagfelvétel atomi és jogosultság-ellenőrzött legyen; az élő kézbesítést
 * a `messages` realtime-publikáció adja (postgres_changes INSERT).
 *
 * Ingyenes (a collab már ingyen — adatbiztonság).
 */

export type ConversationKind = 'dm' | 'project';

export interface ChatPeer {
  id: string;
  name: string | null;
  avatar: string | null;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  ownerId?: string;
  projectId?: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastSenderId: string | null;
  /** DM-nél a MÁSIK fél (a fejléc/inbox-sorhoz); projekt-chatnél nincs */
  peer?: ChatPeer;
  /** van-e nem-olvasott üzenet (a saját last_read_at-hez képest, más feladótól) */
  hasUnread: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  kind: 'text' | 'system';
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  kind: ConversationKind;
  owner_id: string | null;
  project_id: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: 'text' | 'system';
  sender_username: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  created_at: string;
}

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, body, kind, sender_username, sender_name, sender_avatar, created_at';

function toMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    kind: r.kind,
    senderName: r.sender_name,
    senderAvatar: reachableMediaUrl(r.sender_avatar),
    createdAt: r.created_at,
  };
}

/** Az aktuális user id-ja, vagy null. */
export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/**
 * A saját denormalizált feladó-adatok (username/name/avatar) — az üzenetre
 * mentjük, hogy a másik fél név+kép szerint lássa, cross-profil olvasás nélkül
 * (ugyanaz a minta, mint a feed poszt/komment szerzőjénél).
 */
async function senderFields(): Promise<{
  username: string | null;
  name: string | null;
  avatar: string | null;
}> {
  const user = useAuth.getState().user;
  const email = user?.email ?? null;
  const username = email ? email.split('@')[0] : null;
  let name: string | null = username;
  let avatar: string | null = null;
  if (supabase && user?.id) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    name = (data?.full_name as string | undefined) || username;
    avatar = (data?.avatar_url as string | undefined) ?? null;
  }
  return { username, name, avatar };
}

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

/** A beszélgetés olvasottra állítása (a saját last_read_at → most). */
export async function markRead(conversationId: string): Promise<void> {
  const sb = supabase;
  if (!sb) {
    return;
  }
  await sb.rpc('mark_conversation_read', { p_conv: conversationId });
}

// ── partner-feloldás (DM) ──────────────────────────────────────────────────
/** Publikus profil (név+avatar) feloldása id-kra — a profiles owner-only RLS-t a
 * public_profile SECURITY DEFINER kerüli meg (privát mezők nem szivárognak). */
async function resolvePeers(ids: string[]): Promise<Map<string, ChatPeer>> {
  const sb = supabase;
  const out = new Map<string, ChatPeer>();
  if (!sb || ids.length === 0) {
    return out;
  }
  const unique = [...new Set(ids)];
  const rows = await Promise.all(
    unique.map(async (id) => {
      const { data } = await sb.rpc('public_profile', { p_user: id });
      const p = (Array.isArray(data) ? data[0] : data) as
        | { full_name: string | null; avatar_url: string | null }
        | undefined;
      return {
        id,
        name: p?.full_name ?? null,
        avatar: reachableMediaUrl(p?.avatar_url ?? null),
      } as ChatPeer;
    })
  );
  rows.forEach((p) => out.set(p.id, p));
  return out;
}

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
    .select('id, kind, owner_id, project_id, last_message_at, last_message_preview, last_sender_id')
    .order('last_message_at', { ascending: false });
  const rows = (convRows ?? []) as ConversationRow[];
  if (rows.length === 0) {
    return [];
  }

  // DM-partnerek: a beszélgetés MÁSIK tagja
  const dmIds = rows.filter((r) => r.kind === 'dm').map((r) => r.id);
  const peerByConv = new Map<string, string>();
  if (dmIds.length > 0) {
    const { data: others } = await sb
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', dmIds)
      .neq('user_id', uid);
    (others ?? []).forEach((m: { conversation_id: string; user_id: string }) =>
      peerByConv.set(m.conversation_id, m.user_id)
    );
  }
  const peers = await resolvePeers([...peerByConv.values()]);

  return rows.map((r) => {
    const read = lastRead.get(r.id);
    const hasUnread =
      r.last_sender_id != null &&
      r.last_sender_id !== uid &&
      (!read || new Date(r.last_message_at).getTime() > new Date(read).getTime());
    const peerId = peerByConv.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      ownerId: r.owner_id ?? undefined,
      projectId: r.project_id ?? undefined,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastSenderId: r.last_sender_id,
      peer: peerId ? (peers.get(peerId) ?? { id: peerId, name: null, avatar: null }) : undefined,
      hasUnread,
    };
  });
}

/** Egyetlen beszélgetés fejléce (pl. értesítésből/deep-linkből nyitva). */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const list = await listConversations();
  return list.find((c) => c.id === conversationId) ?? null;
}

// ── üzenetek ───────────────────────────────────────────────────────────────
/** A beszélgetés üzenetei, időrendben (régi → új). */
export async function listMessages(conversationId: string, limit = 60): Promise<ChatMessage[]> {
  const sb = supabase;
  if (!sb) {
    return [];
  }
  const { data, error } = await sb
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  // fordított (legújabb elöl) → időrendbe a listához
  return ((data ?? []) as MessageRow[]).map(toMessage).reverse();
}

/** Üzenet küldése (a saját nevemben, denormalizált feladóval). */
export async function sendMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const text = body.trim();
  if (!text) {
    throw new Error('Üres üzenet.');
  }
  const { username, name, avatar } = await senderFields();
  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: uid,
      body: text,
      sender_username: username,
      sender_name: name,
      sender_avatar: avatar,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toMessage(data as MessageRow);
}

// ── realtime ────────────────────────────────────────────────────────────────
/** Monoton számláló egyedi realtime-topichoz (lásd a notifications mintát). */
let channelSeq = 0;

/**
 * Élő üzenet-feliratkozás EGY beszélgetésre (új INSERT). A topic KÖTELEZŐEN
 * egyedi (`:${++channelSeq}`) — a gyors újra-feliratkozás (remount/param-váltás)
 * ne akadjon a még lezáratlan azonos topicon.
 */
export function subscribeMessages(
  conversationId: string,
  onInsert: (m: ChatMessage) => void
): () => void {
  const sb = supabase;
  if (!sb) {
    return () => {};
  }
  const channel = sb
    .channel(`messages:${conversationId}:${++channelSeq}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert(toMessage(payload.new as MessageRow))
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/**
 * Élő inbox-feliratkozás: BÁRMELY beszélgetésem fejléce változik (új üzenet →
 * last_message_at/preview) → újratöltés-jelzés. A `conversations` sorokat az RLS
 * a sajátjaimra szűri, így elég a tábla UPDATE-jeire feliratkozni.
 */
export function subscribeInbox(onChange: () => void): () => void {
  const sb = supabase;
  if (!sb) {
    return () => {};
  }
  const channel = sb
    .channel(`inbox:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () =>
      onChange()
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
