import { supabase } from '@/lib/supabase';
import { toMessage, type ChatMessage, type MessageRow } from '@/lib/chatCore/model';
import { senderFields } from '@/lib/chatClient/session';

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

export interface TypingChannel {
  /** jelzi a többieknek, hogy épp gépelek (belül throttle-olva) */
  notifyTyping: () => void;
  stop: () => void;
}

/**
 * ⌨️ Gépel-jelző csatorna egy beszélgetéshez (Supabase broadcast — NEM perzisztens,
 * nem üzenet). A `self:false` miatt a saját jelzést nem kapom vissza; a küldés
 * ~1,5 mp-enként throttle-olt. A megjelenítést a hívó auto-törli pár mp után.
 */
export function openTypingChannel(
  conversationId: string,
  onTyping: (name: string) => void
): TypingChannel {
  const sb = supabase;
  if (!sb) {
    return { notifyTyping: () => {}, stop: () => {} };
  }
  let myName = 'Valaki';
  void senderFields().then((f) => {
    myName = f.name || f.username || 'Valaki';
  });
  const channel = sb
    .channel(`chat-typing:${conversationId}:${++channelSeq}`, {
      config: { broadcast: { self: false } },
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload && typeof payload.name === 'string') {
        onTyping(payload.name);
      }
    })
    .subscribe();
  let last = 0;
  return {
    notifyTyping: () => {
      const now = Date.now();
      if (now - last < 1500) {
        return;
      }
      last = now;
      void channel.send({ type: 'broadcast', event: 'typing', payload: { name: myName } });
    },
    stop: () => {
      void sb.removeChannel(channel);
    },
  };
}
