// 🎥 LiveKit Egress a workerben (LIVE.md Fázis E) — a felhasználó ENGEDÉLYEZETT
// RTMP-céljaira streameli az élő szobát (RoomComposite → fan-out). A stream-
// kulcsokat service_role-lal olvassa a live_destinations-ből (a kliens sosem
// küldi broadcast-csatornán). A tényleges egress LiveKit Cloud-ot vagy self-host
// egress-szolgáltatást igényel (a lokális `livekit-server --dev` NEM tud egresst)
// — enélkül 503-at ad vissza, nem omlik össze.
const { EgressClient, StreamOutput, StreamProtocol } = require('livekit-server-sdk');
const { createClient } = require('@supabase/supabase-js');

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

/** ws(s)://host:port → http(s)://host:port (az Egress-API HTTP-n megy). */
function egressHttpUrl() {
  return LIVEKIT_URL.replace(/^ws/, 'http');
}

let egressClient = null;
function getEgressClient() {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return null;
  }
  if (!egressClient) {
    egressClient = new EgressClient(egressHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return egressClient;
}

let admin = null;
function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return null;
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  }
  return admin;
}

/** `rtmp://host/app` + `kulcs` → `rtmp://host/app/kulcs` (a teljes ingest-URL). */
function rtmpTarget(rtmpUrl, streamKey) {
  const base = String(rtmpUrl).replace(/\/+$/, '');
  return streamKey ? `${base}/${streamKey}` : base;
}

/**
 * Egress indítása a `userId` ENGEDÉLYEZETT céljaira. A `room` a LiveKit-szoba neve
 * (= a live_session id, mert a token room-ja az). Siker: `{ ok, egressId, destinations }`.
 */
async function startEgress({ room, userId }) {
  const client = getEgressClient();
  if (!client) {
    return {
      ok: false,
      status: 503,
      error: 'LiveKit Egress nincs konfigurálva (LIVEKIT_* + LiveKit Cloud / self-host egress kell).',
    };
  }
  const sb = getAdmin();
  if (!sb) {
    return { ok: false, status: 503, error: 'A worker Supabase service_role-ja nincs beállítva.' };
  }
  // 🔐 host-ownership: CSAK a szoba hostja indíthat egresst, és csak élő session-re
  const { data: sess } = await sb
    .from('live_sessions')
    .select('host_id, status')
    .eq('id', room)
    .maybeSingle();
  if (!sess || sess.host_id !== userId) {
    return { ok: false, status: 403, error: 'Csak a host indíthat egresst a saját szobájára.' };
  }
  if (sess.status !== 'live') {
    return { ok: false, status: 400, error: 'A live session nem aktív.' };
  }
  const { data, error } = await sb
    .from('live_destinations')
    .select('id, platform, label, rtmp_url, stream_key')
    .eq('user_id', userId)
    .eq('enabled', true);
  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  const dests = (data ?? []).filter((d) => d.rtmp_url && d.stream_key);
  if (dests.length === 0) {
    return { ok: false, status: 400, error: 'Nincs engedélyezett, beállított RTMP-cél.' };
  }
  const urls = dests.map((d) => rtmpTarget(d.rtmp_url, d.stream_key));
  const output = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });
  try {
    const info = await client.startRoomCompositeEgress(room, output, { layout: 'grid' });
    return {
      ok: true,
      egressId: info.egressId,
      destinations: dests.map((d) => ({ id: d.id, platform: d.platform, label: d.label })),
    };
  } catch (e) {
    return { ok: false, status: 502, error: `Egress-indítás hiba: ${e.message}` };
  }
}

async function stopEgress(egressId) {
  const client = getEgressClient();
  if (!client) {
    return { ok: false, status: 503, error: 'LiveKit Egress nincs konfigurálva.' };
  }
  try {
    await client.stopEgress(egressId);
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 502, error: `Egress-leállítás hiba: ${e.message}` };
  }
}

/** Be van-e kötve az egress (a Studio ez alapján mutathatja a Pro-multistreamet). */
function egressConfigured() {
  return !!getEgressClient() && !!getAdmin();
}

module.exports = { startEgress, stopEgress, egressConfigured };
