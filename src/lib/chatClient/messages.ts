import { requireSupabase, supabase } from '@/lib/supabase';
import { logCaught } from '@/lib/logCaught';
import { MESSAGE_COLUMNS, toMessage, type ChatMessage, type MessageRow } from '@/lib/chatCore/model';
import { openProjectConversation } from '@/lib/chatClient/conversations';
import { currentUserId, senderFields } from '@/lib/chatClient/session';

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

/**
 * 🧾 RENDSZER-üzenet a beszélgetésbe (kind='system') — a projekt-szoba aktivitás-
 * naplója ezen megy („ki mit csinált"): meghívás, szerep-váltás, verzió-mentés,
 * beállítás-módosítás. A felado az aktuális user (ő végezte a műveletet), a
 * megjelenítés viszont semleges, középre zárt sor (ChatThread).
 */
export async function sendSystemMessage(conversationId: string, body: string): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  const text = body.trim();
  if (!uid || !text) {
    return;
  }
  const { username, name, avatar } = await senderFields();
  await sb.from('messages').insert({
    conversation_id: conversationId,
    sender_id: uid,
    body: text,
    kind: 'system',
    sender_username: username,
    sender_name: name,
    sender_avatar: avatar,
  });
}

/**
 * 🧾 Projekt-aktivitás naplózása a projekt-szobába — BEST-EFFORT (sosem dob,
 * offline/login nélkül csendben kimarad). A szoba mindig elérhető (a
 * get_or_create RPC létrehozza, ha még nincs), így a napló az első művelettől él.
 */
export async function logProjectActivity(
  ownerId: string,
  projectId: string,
  text: string
): Promise<void> {
  try {
    const convId = await openProjectConversation(ownerId, projectId);
    await sendSystemMessage(convId, text);
  } catch (caught) {
    logCaught('lib/chat.ts:logProjectActivity', caught);
    // a napló sosem akaszthatja meg magát a műveletet
  }
}
