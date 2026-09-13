import { cloudBaseUrl } from '@/lib/backend';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🔔 Értesítések kliens-rétege: lista + olvasottság + REALTIME feliratkozás
 * (Supabase Realtime) + küldés a worker /notify-ján át. A deep-link cél a
 * `route` (expo-router útvonal); a UI erre navigál koppintáskor. A push
 * (expo-notifications) később ugyanerre a modellre épül.
 */

export type NotificationType = 'info' | 'comment' | 'invite' | 'mention' | 'render' | 'system';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** deep-link cél (pl. /editor/<id>) */
  route?: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  type: string;
  title: string;
  body: string | null;
  route: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

const COLUMNS = 'id, type, title, body, route, data, read, created_at';

export function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    type: (row.type as NotificationType) ?? 'info',
    title: row.title,
    body: row.body ?? undefined,
    route: row.route ?? undefined,
    data: row.data ?? undefined,
    read: row.read,
    createdAt: row.created_at,
  };
}

/** A user legutóbbi értesítései (legújabb elöl). */
export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('notifications')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data as Row[]).map(toNotification);
}

export async function markRead(id: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('notifications').update({ read: true }).eq('id', id);
}

export async function markAllRead(): Promise<void> {
  const sb = requireSupabase();
  await sb.from('notifications').update({ read: true }).eq('read', false);
}

/** Monoton számláló egyedi realtime-topic-hoz (lásd `subscribeNotifications`). */
let channelSeq = 0;

/**
 * REALTIME feliratkozás a user új értesítéseire (INSERT). Az RLS szűri, hogy csak
 * a sajátjait kapja. `() => void` leiratkozót ad vissza.
 *
 * A topic KÖTELEZŐEN egyedi (`:${++channelSeq}` utótag): a `sb.channel(topic)` a
 * MÁR meglévő, azonos topic-ú csatornát adja vissza (a `removeChannel` aszinkron,
 * csak a záró eseménykor törli a regiszterből), és a már `subscribe()`-olt
 * csatornán a `.on('postgres_changes', …)` dobna („cannot add … callbacks after
 * `subscribe()`"). Gyors újra-feliratkozáskor (StrictMode-remount, login→token-
 * refresh) így mindig friss, `closed` állapotú csatornát kapunk.
 */
export function subscribeNotifications(
  userId: string,
  onInsert: (n: AppNotification) => void
): () => void {
  const sb = supabase;
  if (!sb) {
    return () => {};
  }
  const channel = sb
    .channel(`notifications:${userId}:${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(toNotification(payload.new as Row))
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/**
 * SAJÁT értesítés létrehozása (self-insert RLS) — pl. „kész a felhő-render",
 * napi tipp. Realtime kézbesíti a saját eszközökre. Best-effort (nem dob).
 * Cross-user küldés (collab: más usernek) service_role-t igényel → worker /notify
 * (későbbi lépés, lásd TODO.md).
 */
export async function createNotification(input: {
  type?: NotificationType;
  title: string;
  body?: string;
  route?: string;
  data?: Record<string, unknown>;
}): Promise<boolean> {
  const sb = supabase;
  const uid = currentUserId();
  if (!sb || !uid) {
    return false;
  }
  const { error } = await sb.from('notifications').insert({
    user_id: uid,
    type: input.type ?? 'info',
    title: input.title,
    body: input.body ?? null,
    route: input.route ?? null,
    data: input.data ?? null,
  });
  return !error;
}

/**
 * Értesítés küldése MÁS usernek (collab: komment/meghívó/mention) — a worker
 * `POST /notify`-ján át, mert cross-user íráshoz service_role kell (az RLS csak
 * a sajátot engedi). A worker beszúrja a sort (realtime kézbesíti) + Expo push-t
 * küld a cél-user push_token-jeire. Best-effort (nem dob). SAJÁT értesítéshez a
 * `createNotification` (közvetlen self-insert) is elég.
 */
export async function sendNotification(
  userId: string,
  input: {
    type?: NotificationType;
    title: string;
    body?: string;
    route?: string;
    data?: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...input }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A jelenlegi user id-ja (a realtime feliratkozáshoz), vagy null. */
export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}
