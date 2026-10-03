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
  const { data, error } = await sb
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

/** A frissen induló élő `viewer_peak`-jének emelése, ha a jelenlegi nézőszám nagyobb. */
export async function bumpViewerPeak(id: string, current: number): Promise<void> {
  const sb = requireSupabase();
  // csak a host hívja (RLS), és csak emel
  await sb.from('live_sessions').update({ viewer_peak: current }).eq('id', id).lt('viewer_peak', current);
}

/** A „most élőben" lista. */
export async function listLiveNow(limit = 50): Promise<LiveSession[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('live_sessions')
    .select('id, host_id, title, status, host_username, host_name, host_avatar, started_at, viewer_peak')
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as RawLive[]).map(mapLive);
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
export function subscribeLiveList(onChange: () => void): () => void {
  if (!supabase) {
    return () => {};
  }
  const ch = supabase
    .channel('live-list')
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

export interface LiveRoom {
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  stop: () => void;
}

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
  const channel = supabase.channel(`live:${sessionId}`, {
    config: { presence: { key: self.id }, broadcast: { self: true } },
  });

  const readViewers = () => {
    const state = channel.presenceState() as Record<string, unknown[]>;
    handlers.onViewers(Object.keys(state).length);
  };

  channel
    .on('broadcast', { event: 'chat' }, ({ payload }) => handlers.onChat(payload as LiveChat))
    .on('broadcast', { event: 'reaction' }, ({ payload }) =>
      handlers.onReaction((payload as { emoji: string }).emoji),
    )
    .on('presence', { event: 'sync' }, readViewers)
    .on('presence', { event: 'join' }, readViewers)
    .on('presence', { event: 'leave' }, readViewers)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ id: self.id, name: self.name, avatar: self.avatar });
      }
    });

  return {
    sendChat: (text) => {
      const msg: LiveChat = {
        id: self.id,
        name: self.name,
        avatar: self.avatar,
        text: text.slice(0, 500),
        at: Date.now(),
      };
      void channel.send({ type: 'broadcast', event: 'chat', payload: msg });
    },
    sendReaction: (emoji) => {
      void channel.send({ type: 'broadcast', event: 'reaction', payload: { emoji } });
    },
    stop: () => {
      void supabase!.removeChannel(channel);
    },
  };
}
