import { cloudBaseUrl } from '@/lib/backend';
import { myUserId } from '@/lib/live';
import { requireSupabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import type { LivePlatform } from '@/types/live';

/**
 * 🎥 Külső multistream-célok (LIVE.md Fázis E) — a felhasználó RTMP-céljai
 * (YouTube/TikTok/Twitch/Facebook/custom). A `stream_key` ÉRZÉKENY: owner-only
 * RLS védi, és EZ A RÉTEG SOHA NEM OLVASSA VISSZA (a lista-lekérés kihagyja). A
 * worker a service_role-lal olvassa az egress-indításkor. A kulcs sosem megy a
 * broadcast live-docba (az csak platform-toggle).
 */

/** Egy cél a kliensnek (kulcs NÉLKÜL). */
export interface LiveDestinationRow {
  id: string;
  platform: LivePlatform;
  label: string;
  rtmpUrl: string;
  /** be van-e állítva stream-kulcs (a kulcsot magát sosem adjuk vissza). */
  hasKey: boolean;
  enabled: boolean;
}

interface RawDest {
  id: string;
  platform: LivePlatform;
  label: string;
  rtmp_url: string;
  stream_key: string | null;
  enabled: boolean;
}

function mapDest(r: RawDest): LiveDestinationRow {
  return {
    id: r.id,
    platform: r.platform,
    label: r.label,
    rtmpUrl: r.rtmp_url,
    hasKey: !!r.stream_key,
    enabled: r.enabled,
  };
}

/** A felhasználó céljai (kulcs nélkül). */
export async function listDestinations(): Promise<LiveDestinationRow[]> {
  const sb = requireSupabase();
  // a stream_key-t lekérjük, de CSAK a `hasKey` jelzőhöz — a kliensnek sosem adjuk vissza
  const { data, error } = await sb
    .from('live_destinations')
    .select('id, platform, label, rtmp_url, stream_key, enabled')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as RawDest[]).map(mapDest);
}

export async function addDestination(input: {
  platform: LivePlatform;
  label: string;
  rtmpUrl: string;
  streamKey: string;
  enabled?: boolean;
}): Promise<LiveDestinationRow> {
  const sb = requireSupabase();
  const uid = myUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { data, error } = await sb
    .from('live_destinations')
    .insert({
      user_id: uid, // kötelező az RLS-hez (auth.uid() = user_id)
      platform: input.platform,
      label: input.label.trim() || input.platform,
      rtmp_url: input.rtmpUrl.trim(),
      stream_key: input.streamKey.trim(),
      enabled: input.enabled ?? true,
    })
    .select('id, platform, label, rtmp_url, stream_key, enabled')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return mapDest(data as RawDest);
}

export async function setDestinationEnabled(id: string, enabled: boolean): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('live_destinations').update({ enabled }).eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

export async function removeDestination(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('live_destinations').delete().eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/** Van-e a felhasználónak ENGEDÉLYEZETT, beállított (kulcsos) RTMP-célja. */
export async function hasEnabledTargets(): Promise<boolean> {
  return (await listDestinations()).some((d) => d.enabled && d.hasKey);
}

export interface EgressStart {
  egressId: string;
  destinations: { id: string; platform: LivePlatform; label: string }[];
}

/**
 * 🎥 Multistream egress indítása a worker-en (Pro). A `room` = a live-session id.
 * A worker ellenőrzi a host-ownershipet + olvassa a kulcsokat (service_role).
 * Hibánál dob (pl. 503 = nincs egress-infra / LiveKit Cloud; 402/403 = nem Pro).
 */
export async function startLiveEgress(room: string): Promise<EgressStart> {
  const res = await fetch(`${cloudBaseUrl()}/live/egress/start`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ room }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Egress-hiba (${res.status})`);
  }
  return (await res.json()) as EgressStart;
}

export async function stopLiveEgress(egressId: string): Promise<void> {
  await fetch(`${cloudBaseUrl()}/live/egress/stop`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ egressId }),
  }).catch(() => {});
}
