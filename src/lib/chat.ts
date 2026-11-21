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

// Barrel — expo-mentes mag: chatCore/ (modellek, sor-leképezés, csoport-cím);
// hálózat: chatClient/ (Supabase: session, beszélgetés-RPC-k, partner-feloldás, inbox, üzenetek, realtime)
export {
  groupTitle,
  type ChatMessage,
  type ChatPeer,
  type Conversation,
  type ConversationKind,
} from '@/lib/chatCore/model';
export { currentUserId } from '@/lib/chatClient/session';
export {
  addGroupMember,
  createGroup,
  leaveConversation,
  markRead,
  openDm,
  openProjectConversation,
  renameGroup,
} from '@/lib/chatClient/conversations';
export { listFollowingPeers } from '@/lib/chatClient/peers';
export { getConversation, listConversations } from '@/lib/chatClient/inbox';
export { listMessages, logProjectActivity, sendMessage, sendSystemMessage } from '@/lib/chatClient/messages';
export {
  openTypingChannel,
  subscribeInbox,
  subscribeMessages,
  type TypingChannel,
} from '@/lib/chatClient/realtime';
