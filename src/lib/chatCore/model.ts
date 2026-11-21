import { reachableMediaUrl } from '@/lib/mediaUrl';

export type ConversationKind = 'dm' | 'project' | 'group';

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
  /** csoport neve (kind='group'); ha nincs, a tagnevekből képezzük a címet */
  title?: string;
  /** DM-nél a MÁSIK fél (a fejléc/inbox-sorhoz); projekt-chatnél nincs */
  peer?: ChatPeer;
  /** csoportnál a TÖBBI tag (avatar-stack + cím); DM/projektnél nincs */
  members?: ChatPeer[];
  /** projekt-chatnél a projekt neve (felhőből vagy a helyi listából); ha ismeretlen, nincs */
  projectName?: string;
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

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  owner_id: string | null;
  project_id: string | null;
  title: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_id: string | null;
}

export interface MessageRow {
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

export const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, body, kind, sender_username, sender_name, sender_avatar, created_at';

export function toMessage(r: MessageRow): ChatMessage {
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

/** A csoport megjelenített neve: a beállított cím, vagy a tagok nevéből képezve. */
export function groupTitle(conv: Conversation, fallback: string): string {
  if (conv.title) {
    return conv.title;
  }
  const names = (conv.members ?? [])
    .map((m) => m.name)
    .filter((n): n is string => !!n);
  return names.length > 0 ? names.join(', ') : fallback;
}
