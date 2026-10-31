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
  /** a szerver-oldali jelző (a kulcs maga a kliensnek NEM olvasható — L4) */
  has_key?: boolean;
  /** csak a migráció előtti szerveren (tartalék) */
  stream_key?: string | null;
  enabled: boolean;
}

const COLS: string = 'id, platform, label, rtmp_url, has_key, enabled';
/** a migráció ELŐTTI séma (has_key oszlop nélkül) — csak tartalékként */
const LEGACY_COLS: string = 'id, platform, label, rtmp_url, stream_key, enabled';
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /has_key/.test(e.message ?? ''));

/**
 * 🔐 PRO-LIVE L7 (kliens-tükör): csak rtmp(s)://, hitelesítő adat és belső hálózati cím
 * nélkül — a teljes, DNS-sel is ellenőrzött validáció a workerben fut. → hiba-kulcs vagy null
 */
export function rtmpUrlProblem(raw: string): string | null {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'live.dest.errUrl';
  }
  if (u.protocol !== 'rtmp:' && u.protocol !== 'rtmps:') return 'live.dest.errScheme';
  if (u.username || u.password) return 'live.dest.errUrl';
  const h = u.hostname.toLowerCase();
  if (
    !h ||
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h.startsWith('[')
  ) {
    return 'live.dest.errPrivate';
  }
  return null;
}

function mapDest(r: RawDest): LiveDestinationRow {
  return {
    id: r.id,
    platform: r.platform,
    label: r.label,
    rtmpUrl: r.rtmp_url,
    hasKey: r.has_key ?? !!r.stream_key,
    enabled: r.enabled,
  };
}

/** A felhasználó céljai (kulcs nélkül). */
export async function listDestinations(): Promise<LiveDestinationRow[]> {
  const sb = requireSupabase();
  // a kulcs helyett a `has_key` jelző (L4) — a migráció előtti szerveren a régi lekérés
  let res = await sb.from('live_destinations').select(COLS).order('created_at', { ascending: true });
  if (isMissingColumn(res.error)) {
    res = await sb.from('live_destinations').select(LEGACY_COLS).order('created_at', { ascending: true });
  }
  if (res.error) {
    throw new Error(res.error.message);
  }
  return ((res.data ?? []) as unknown as RawDest[]).map(mapDest);
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
  const problem = rtmpUrlProblem(input.rtmpUrl);
  if (problem) {
    throw new Error(problem);
  }
  // 🔐 F2 + L6: a sort kulcs NÉLKÜL és KIKAPCSOLVA szúrjuk be (a nyers kulcs sosem a
  // kliens-írható úton tárolódik); a kulcsot a worker titkosítja + írja, és CSAK a sikeres
  // kulcs-mentés után kapcsoljuk be — a félbemaradt mentés nem hagy élő, üres célt.
  const base = {
    user_id: uid, // kötelező az RLS-hez (auth.uid() = user_id)
    platform: input.platform,
    label: input.label.trim() || input.platform,
    rtmp_url: input.rtmpUrl.trim(),
    enabled: false,
  };
  let ins = await sb.from('live_destinations').insert(base).select(COLS).single();
  if (ins.error && (isMissingColumn(ins.error) || /stream_key/.test(ins.error.message))) {
    // migráció előtti séma: a stream_key NOT NULL alapérték nélkül + nincs has_key
    ins = await sb.from('live_destinations').insert({ ...base, stream_key: '' }).select(LEGACY_COLS).single();
  }
  if (ins.error) {
    throw new Error(ins.error.message);
  }
  const row = mapDest(ins.data as unknown as RawDest);
  const key = input.streamKey.trim();
  if (key) {
    await setDestinationKey(row.id, key);
    row.hasKey = true;
    if (input.enabled ?? true) {
      await setDestinationEnabled(row.id, true);
      row.enabled = true;
    }
  }
  return row;
}

/**
 * 🔐 F2: a nyers RTMP stream-kulcs beállítása a workeren keresztül (TLS → AES-GCM
 * titkosítás nyugalmi állapotban). A kliens sosem ír/olvas nyers kulcsot a DB-be.
 */
export async function setDestinationKey(destinationId: string, streamKey: string): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/live/destinations/set-key`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ destinationId, streamKey }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Kulcs-mentési hiba (${res.status})`);
  }
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
  /** 📼 D158: a VOD publikus URL-je (ha az egress S3-ba is rögzít), vagy null. */
  vodUrl?: string | null;
}

/**
 * 🎥 Multistream egress indítása a worker-en (Pro). A `room` = a live-session id.
 * A worker ellenőrzi a host-ownershipet + olvassa a kulcsokat (service_role).
 * Hibánál dob (pl. 503 = nincs egress-infra / LiveKit Cloud; 402/403 = nem Pro).
 */
export async function startLiveEgress(room: string, record = false, aspect?: string): Promise<EgressStart> {
  const res = await fetch(`${cloudBaseUrl()}/live/egress/start`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    // 📼 a `record` jelzi: készüljön VOD-fájl (akár RTMP-cél nélkül is) — a szerver
    //    csak-felvétel esetén is elindítja az egresst (fájl-only kimenet).
    // 📐 az `aspect` (a live-projekt aránya) az egress-kimenet méretét állítja (portré/landscape).
    body: JSON.stringify({ room, record, aspect }),
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
