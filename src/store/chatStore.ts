import { create } from 'zustand';

import {
  currentUserId,
  listConversations,
  listMessages,
  markRead,
  sendMessage,
  subscribeInbox,
  subscribeMessages,
  type ChatMessage,
  type Conversation,
} from '@/lib/chat';

/**
 * 💬 Chat-store — az inbox (beszélgetés-lista + olvasatlan-szám) ÉS az éppen
 * nyitott beszélgetés (üzenetek + realtime). A badge-hez a root indítja az
 * inbox-figyelést; a beszélgetés-képernyő nyit/zár egy konkrét beszélgetést.
 *
 * A saját küldött üzenet OPTIMISTA (azonnal megjelenik), a realtime INSERT-et
 * id szerint dedupláljuk — nincs dupla buborék, de távoli üzenet élőben jön.
 */

interface ChatState {
  // inbox
  conversations: Conversation[];
  inboxLoading: boolean;
  unreadTotal: number;
  // aktív beszélgetés
  activeId: string | null;
  messages: ChatMessage[];
  activeLoading: boolean;
  error: string | null;

  /** inbox betöltés + realtime figyelés indítása (badge). Visszaadja a leiratkozót. */
  startInbox: () => () => void;
  loadInbox: () => Promise<void>;
  /** beszélgetés megnyitása: üzenetek + olvasottra állítás + realtime feliratkozás */
  openConversation: (conversationId: string) => Promise<void>;
  closeConversation: () => void;
  /** üzenet küldése az aktív beszélgetésbe (optimista) */
  send: (body: string) => Promise<void>;
}

let inboxUnsub: (() => void) | null = null;
let activeUnsub: (() => void) | null = null;

function unreadCount(list: Conversation[]): number {
  return list.reduce((n, c) => n + (c.hasUnread ? 1 : 0), 0);
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  inboxLoading: false,
  unreadTotal: 0,
  activeId: null,
  messages: [],
  activeLoading: false,
  error: null,

  startInbox: () => {
    void get().loadInbox();
    inboxUnsub?.();
    inboxUnsub = subscribeInbox(() => {
      void get().loadInbox();
    });
    return () => {
      inboxUnsub?.();
      inboxUnsub = null;
    };
  },

  loadInbox: async () => {
    if (!currentUserId()) {
      set({ conversations: [], unreadTotal: 0 });
      return;
    }
    set({ inboxLoading: true });
    try {
      const list = await listConversations();
      set({ conversations: list, unreadTotal: unreadCount(list), inboxLoading: false });
    } catch {
      set({ inboxLoading: false });
    }
  },

  openConversation: async (conversationId) => {
    // előző beszélgetés realtime-leiratkozása
    activeUnsub?.();
    activeUnsub = null;
    set({ activeId: conversationId, messages: [], activeLoading: true, error: null });
    try {
      const msgs = await listMessages(conversationId);
      // közben nem váltottak-e másik beszélgetésre?
      if (get().activeId !== conversationId) {
        return;
      }
      set({ messages: msgs, activeLoading: false });
      // olvasottra állítás + lokális badge-frissítés
      void markRead(conversationId);
      set((s) => {
        const conversations = s.conversations.map((c) =>
          c.id === conversationId ? { ...c, hasUnread: false } : c
        );
        return { conversations, unreadTotal: unreadCount(conversations) };
      });
      // élő üzenetek — id szerint dedup
      activeUnsub = subscribeMessages(conversationId, (m) => {
        if (get().activeId !== conversationId) {
          return;
        }
        set((s) => {
          if (s.messages.some((x) => x.id === m.id)) {
            return s;
          }
          return { messages: [...s.messages, m] };
        });
        // a saját nézetben olvasottnak számít
        void markRead(conversationId);
      });
    } catch (e) {
      set({ activeLoading: false, error: e instanceof Error ? e.message : 'Hiba' });
    }
  },

  closeConversation: () => {
    activeUnsub?.();
    activeUnsub = null;
    set({ activeId: null, messages: [], error: null });
    // az inbox olvasatlan-állapota frissüljön a bezárt beszélgetés után
    void get().loadInbox();
  },

  send: async (body) => {
    const conversationId = get().activeId;
    if (!conversationId) {
      return;
    }
    try {
      const msg = await sendMessage(conversationId, body);
      // optimista beszúrás (a realtime ugyanezt id szerint deduplálja)
      set((s) => {
        if (s.messages.some((x) => x.id === msg.id)) {
          return s;
        }
        return { messages: [...s.messages, msg] };
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Nem sikerült elküldeni.' });
      throw e;
    }
  },
}));
