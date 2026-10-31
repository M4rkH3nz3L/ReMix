import { createRateLimiter } from '@/lib/liveRate';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🔴 Élő közvetítés (Live) — session-életciklus + „most élőben" lista + a LIVE-room
 * realtime-rétege (presence = nézőszám, broadcast = chat + reakciók), a `collabLive`
 * mintájára. A tényleges videó-transzport (host→nézők) providert igényel
 * (LiveKit/Mux/Agora) — az a `LiveRoom` fölé jön majd; ez a réteg a social/realtime
 * mag, ami a meglévő Supabase-stacken teljes értékűen MŰKÖDIK.
 */

export interface LiveSession {
  id: string;
  hostId: string;
  title: string;
  status: 'live' | 'ended';
  hostUsername: string | null;
  hostName: string | null;
  hostAvatar: string | null;
  startedAt: string;
  viewerPeak: number;
}

interface RawLive {
  id: string;
  host_id: string;
  title: string;
  status: 'live' | 'ended';
  host_username: string | null;
  host_name: string | null;
  host_avatar: string | null;
  started_at: string;
  viewer_peak: number;
}

function mapLive(r: RawLive): LiveSession {
  return {
    id: r.id,
    hostId: r.host_id,
    title: r.title,
    status: r.status,
    hostUsername: r.host_username,
    hostName: r.host_name,
    hostAvatar: r.host_avatar,
    startedAt: r.started_at,
    viewerPeak: r.viewer_peak,
  };
}

/** A bejelentkezett user id-ja (nem-reaktív döntésekhez). */
export function myUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

export interface LiveSelf {
  id: string;
  name: string;
  avatar: string | null;
}

/** A saját denormalizált adatok a presence-hez/chat-hez (mint a collabLive-ban). */
export async function buildLiveSelf(): Promise<LiveSelf | null> {
  const me = useAuth.getState().user;
  if (!me) {
    return null;
  }
  let name = me.email?.split('@')[0] ?? 'Én';
  let avatar: string | null = null;
  try {
    const { data } = await supabase!
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', me.id)
      .maybeSingle();
    name = (data?.full_name as string | undefined) || (data?.username as string | undefined) || name;
    avatar = (data?.avatar_url as string | undefined) ?? null;
  } catch {
    // best-effort; marad az e-mail-előtag
  }
  return { id: me.id, name, avatar };
}

/** Élő indítása: létrehoz egy `live` sessiont a saját profillal denormalizálva. */
export async function startLive(title: string): Promise<LiveSession> {
  const sb = requireSupabase();
  const self = await buildLiveSelf();
  if (!self) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { data: prof } = await sb
    .from('profiles')
    .select('username')
    .eq('id', self.id)
    .maybeSingle();
  const insert = () =>
    sb
      .from('live_sessions')
      .insert({
        host_id: self.id,
        title: title.trim() || 'Élő',
        status: 'live',
        host_username: (prof?.username as string | undefined) ?? null,
        host_name: self.name,
        host_avatar: self.avatar,
      })
      .select('id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak')
      .single();
  let { data, error } = await insert();
  // 🩹 L14: egy korábbi (crash / app-kill után) beragadt „live" session az egyedi index miatt
  // blokkolta az új adást → a host SAJÁT beragadt sessionjeit lezárjuk, és újrapróbáljuk
  if (error && (error.code === '23505' || /duplicate key|one_live_per_host/i.test(error.message))) {
    await sb.from('live_sessions').update({ status: 'ended' }).eq('host_id', self.id).eq('status', 'live');
    ({ data, error } = await insert());
  }
  if (error) {
    throw new Error(error.message);
  }
  return mapLive(data as RawLive);
}

/** Élő leállítása (csak a host — RLS). */
export async function endLive(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('live_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * 💓 L14: a host 30 mp-enként „él még" jelet küld — a szerveres sweep a jel nélküli
 * (crash / app-kill) sessiont lezárja, a „Most élő" lista pedig csak a friss adásokat mutatja.
 * Best-effort (a migráció előtti szerveren a mező hiányzik → csendben kimarad).
 */
export async function heartbeatLive(id: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('live_sessions').update({ last_heartbeat: new Date().toISOString() }).eq('id', id).eq('status', 'live');
}

/** a „Most élő" lista frissességi küszöbe (ennél régebbi heartbeat = szellem-session) */
export const LIVE_STALE_MS = 3 * 60 * 1000;

/** A frissen induló élő `viewer_peak`-jének emelése, ha a jelenlegi nézőszám nagyobb. */
export async function bumpViewerPeak(id: string, current: number): Promise<void> {
  const sb = requireSupabase();
  // csak a host hívja (RLS), és csak emel
  await sb.from('live_sessions').update({ viewer_peak: current }).eq('id', id).lt('viewer_peak', current);
}

/** A „most élőben" lista. */
export async function listLiveNow(limit = 50): Promise<LiveSession[]> {
  const sb = requireSupabase();
  const cols = 'id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak';
  const fresh = new Date(Date.now() - LIVE_STALE_MS).toISOString();
  // 🩹 L14: a heartbeat nélküli (beragadt) session nem jelenik meg „élőként"
  let res = await sb
    .from('live_sessions')
    .select(cols)
    .eq('status', 'live')
    .gt('last_heartbeat', fresh)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (res.error && /last_heartbeat/.test(res.error.message)) {
    res = await sb.from('live_sessions').select(cols).eq('status', 'live').order('started_at', { ascending: false }).limit(limit);
  }
  if (res.error) {
    throw new Error(res.error.message);
  }
  return ((res.data ?? []) as RawLive[]).map(mapLive);
}

/** A KÖVETETT hostok élő adásai (a feed „LIVE now" sávjához). */
export async function listLiveFollowing(limit = 20): Promise<LiveSession[]> {
  const sb = requireSupabase();
  const uid = myUserId();
  if (!uid) {
    return [];
  }
  const { data: fData } = await sb.from('follows').select('following_id').eq('follower_id', uid);
  const ids = [...new Set((fData ?? []).map((r: { following_id: string }) => r.following_id))];
  if (ids.length === 0) {
    return [];
  }
  const { data, error } = await sb
    .from('live_sessions')
    .select('id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak')
    .eq('status', 'live')
    .in('host_id', ids)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as RawLive[]).map(mapLive);
}

/** Egy host AKTUÁLIS élő session-je (a csatorna LIVE-jelzőjéhez), vagy null. */
export async function getLiveByHost(hostId: string): Promise<LiveSession | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('live_sessions')
    .select('id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak')
    .eq('host_id', hostId)
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return null;
  }
  return data ? mapLive(data as RawLive) : null;
}

/** Egy élő session lekérése id alapján (a room-belépéshez). */
export async function getLive(id: string): Promise<LiveSession | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('live_sessions')
    .select('id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? mapLive(data as RawLive) : null;
}

/** Realtime-figyelő a „most élőben" listához (insert/update → újratöltés). */
// egyedi csatorna-név feliratkozásonként — TÖBB fogyasztó is lehet (pl. a Live-hub
// ÉS a feed LiveNowStrip-je). Fix névnél a 2. feliratkozó a már subscribe-olt
// csatornát kapná vissza → „cannot add postgres_changes callbacks after subscribe()".
let liveListSeq = 0;

export function subscribeLiveList(onChange: () => void): () => void {
  if (!supabase) {
    return () => {};
  }
  liveListSeq += 1;
  const ch = supabase
    .channel(`live-list-${liveListSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, () => onChange())
    .subscribe();
  return () => {
    void supabase!.removeChannel(ch);
  };
}

// ── LIVE-room realtime (presence = nézők, broadcast = chat + reakció) ────────

export interface LiveChat {
  id: string;
  name: string;
  avatar: string | null;
  text: string;
  at: number;
}

/** a megengedett reakciók (a bejövő broadcast csak ezeket fogadja — L2) */
export const LIVE_REACTIONS = ['❤️', '🔥', '👏', '😂', '🎉'] as const;

interface ChatRow {
  id: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  body: string;
  created_at: string;
}

const rowToChat = (r: ChatRow): LiveChat => ({
  id: r.author_id,
  name: r.author_name || r.author_id.slice(0, 8),
  avatar: r.author_avatar,
  text: r.body,
  at: Date.parse(r.created_at) || Date.now(),
});

/** a táblás (ellenőrzött) chat még nem érhető el (a migráció előtti szerver) */
const isMissingRelation = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? ''));

export interface LiveRoom {
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  stop: () => void;
}

/**
 * 🔴 A live-szoba realtime rétege. PRO-LIVE L2/L12:
 *  • a CHAT a `live_chat_messages` táblán megy (a szerzőt az RLS, a nevet a DB adja → nincs
 *    megszemélyesítés; szerveres rate limit; a késői csatlakozó az utolsó 50 üzenetet is
 *    látja). Ha a szerveren még nincs meg a tábla, a régi broadcast-út a tartalék;
 *  • a JELENET már nem itt megy (a néző a LiveKit adatcsatornáról, host-hitelesítve kapja);
 *  • a reakció broadcast, de csak a fehérlistás emojik.
 */
export function openLiveRoom(
  sessionId: string,
  self: LiveSelf,
  handlers: {
    onChat: (m: LiveChat) => void;
    onReaction: (emoji: string) => void;
    onViewers: (count: number) => void;
  },
): LiveRoom {
  if (!supabase) {
    return { sendChat: () => {}, sendReaction: () => {}, stop: () => {} };
  }
  const sb = supabase;
  const channel = sb.channel(`live:${sessionId}`, {
    config: { presence: { key: self.id }, broadcast: { self: true } },
  });
  let chatMode: 'table' | 'broadcast' | 'unknown' = 'unknown';

  const readViewers = () => {
    const state = channel.presenceState() as Record<string, unknown[]>;
    handlers.onViewers(Object.keys(state).length);
  };

  // 🛡️ F4 — BEJÖVŐ flood-védelem (a táblás chatnél a szerver is limitál)
  const inChat = createRateLimiter(15, 8);
  const inReaction = createRateLimiter(25, 15);

  channel
    .on('broadcast', { event: 'chat' }, ({ payload }) => {
      // a hamisítható broadcast-chat CSAK tartalék módban él
      if (chatMode !== 'broadcast' || !inChat.allow()) return;
      const m = payload as Partial<LiveChat>;
      if (typeof m?.text === 'string' && typeof m.id === 'string') {
        handlers.onChat({ id: m.id, name: String(m.name ?? '').slice(0, 80), avatar: null, text: m.text.slice(0, 300), at: Date.now() });
      }
    })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => {
      const emoji = (payload as { emoji?: unknown })?.emoji;
      if (typeof emoji === 'string' && (LIVE_REACTIONS as readonly string[]).includes(emoji) && inReaction.allow()) {
        handlers.onReaction(emoji);
      }
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'live_chat_messages', filter: `session_id=eq.${sessionId}` },
      (change) => {
        if (inChat.allow()) handlers.onChat(rowToChat(change.new as ChatRow));
      },
    )
    .on('presence', { event: 'sync' }, readViewers)
    .on('presence', { event: 'join' }, readViewers)
    .on('presence', { event: 'leave' }, readViewers)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ id: self.id, name: self.name, avatar: self.avatar });
      }
    });

  // a chat-előzmény (késői csatlakozó) + a mód eldöntése
  void sb
    .from('live_chat_messages')
    .select('id, author_id, author_name, author_avatar, body, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(50)
    .then(({ data, error }) => {
      if (error) {
        chatMode = isMissingRelation(error) ? 'broadcast' : 'table';
        return;
      }
      chatMode = 'table';
      for (const r of [...((data ?? []) as ChatRow[])].reverse()) handlers.onChat(rowToChat(r));
    });

  const outChat = createRateLimiter(3, 1); // 1 chat/mp, 3 burst (a szerver is limitál)
  const outReaction = createRateLimiter(6, 3);

  return {
    sendChat: (text) => {
      const body = text.trim().slice(0, 300);
      if (!body || !outChat.allow()) {
        return;
      }
      if (chatMode === 'broadcast') {
        const msg: LiveChat = { id: self.id, name: self.name, avatar: self.avatar, text: body, at: Date.now() };
        void channel.send({ type: 'broadcast', event: 'chat', payload: msg });
        return;
      }
      void sb
        .from('live_chat_messages')
        .insert({ session_id: sessionId, body })
        .then(({ error }) => {
          if (isMissingRelation(error)) {
            chatMode = 'broadcast';
            const msg: LiveChat = { id: self.id, name: self.name, avatar: self.avatar, text: body, at: Date.now() };
            void channel.send({ type: 'broadcast', event: 'chat', payload: msg });
          }
        });
    },
    sendReaction: (emoji) => {
      if (!(LIVE_REACTIONS as readonly string[]).includes(emoji) || !outReaction.allow()) {
        return;
      }
      void channel.send({ type: 'broadcast', event: 'reaction', payload: { emoji } });
    },
    stop: () => {
      void sb.removeChannel(channel);
    },
  };
}
