// 🎥 LiveKit Egress a workerben (LIVE.md Fázis E) — a felhasználó ENGEDÉLYEZETT
// RTMP-céljaira streameli az élő szobát (RoomComposite → fan-out). A stream-
// kulcsokat service_role-lal olvassa a live_destinations-ből (a kliens sosem
// küldi broadcast-csatornán). A tényleges egress LiveKit Cloud-ot vagy self-host
// egress-szolgáltatást igényel (a lokális `livekit-server --dev` NEM tud egresst)
// — enélkül 503-at ad vissza, nem omlik össze.
const {
  EgressClient,
  RoomServiceClient,
  StreamOutput,
  StreamProtocol,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} = require('livekit-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const { decryptStreamKey } = require('./liveCrypto');
const { trackUsage } = require('./usage');

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

let roomClient = null;
function getRoomClient() {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return null;
  }
  if (!roomClient) {
    roomClient = new RoomServiceClient(egressHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomClient;
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

// 📼 D158 — VOD az adás után. Ha az `EGRESS_VOD=1` + S3 konfigurált, az egress a
// stream MELLÉ egy MP4-et is ír az S3-ba (`live-vod/{room}.mp4`); az adás végén a
// kliens ebből csinál feed-posztot (publishLiveVod). A bizonyított stream-utat nem
// érinti: VOD nélkül az output marad a sima StreamOutput.
function vodEnabled() {
  return (
    process.env.EGRESS_VOD === '1' &&
    !!(process.env.S3_ACCESS_KEY || '').trim() &&
    !!(process.env.S3_SECRET_KEY || '').trim() &&
    !!(process.env.S3_BUCKET || '').trim()
  );
}

/** Az adott szoba VOD-jának S3-kulcsa (determinisztikus, a kliens is kiszámolja). */
function vodKey(room) {
  return `live-vod/${room}.mp4`;
}

/** A VOD publikus URL-je (S3_PUBLIC_BASE), ha VOD aktív — különben null. */
function vodUrl(room) {
  if (!vodEnabled()) {
    return null;
  }
  const base = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, '');
  return base ? `${base}/${vodKey(room)}` : null;
}

/** EncodedFileOutput az S3-ba (MP4), vagy null, ha a VOD nincs bekapcsolva. */
function buildVodOutput(room) {
  if (!vodEnabled()) {
    return null;
  }
  const s3 = new S3Upload({
    accessKey: (process.env.S3_ACCESS_KEY || '').trim(),
    secret: (process.env.S3_SECRET_KEY || '').trim(),
    bucket: (process.env.S3_BUCKET || '').trim(),
    region: (process.env.S3_REGION || 'us-east-1').trim(),
    endpoint: (process.env.S3_ENDPOINT || '').trim() || undefined,
    forcePathStyle: !!(process.env.S3_ENDPOINT || '').trim(),
  });
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: vodKey(room),
    output: { case: 's3', value: s3 },
  });
}

// 💰 F3 — költségkontroll. A szerveroldali egress valós pénz (komponálás+enkódolás)
// → max párhuzamos egress/user + max adás-hossz (auto-stop). A `live_egress` tábla
// a futó adásokat követi (service_role írja); best-effort: ha a tábla még nincs
// (migráció előtt), a korlátozás „megenged" degradál, az egress nem törik el.
function intEnv(name, def) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
const MAX_CONCURRENT_EGRESS = () => intEnv('MAX_CONCURRENT_EGRESS', 1);
const MAX_EGRESS_MINUTES = () => intEnv('MAX_EGRESS_MINUTES', 240);

/** A user aktív egress-einek száma. `-1`, ha nem elérhető (tábla hiányzik). */
async function countActiveEgress(sb, userId) {
  if (!sb) {
    return -1;
  }
  const { count, error } = await sb
    .from('live_egress')
    .select('egress_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) {
    return -1;
  }
  return count ?? 0;
}

async function recordEgress(sb, row) {
  if (!sb) {
    return;
  }
  const { error } = await sb.from('live_egress').insert({
    egress_id: row.egressId,
    user_id: row.userId,
    room: row.room,
    destinations: row.destinations,
    status: 'active',
  });
  if (error) {
    console.warn(`[liveEgress] tracking-insert nem sikerült (best-effort): ${error.message}`);
  }
}

/** A multistream-egress perchossza két ISO-időpontból (nem-negatív; rossz input → 0). */
function egressMinutes(startedAtIso, stoppedAtIso) {
  const start = Date.parse(startedAtIso);
  const stop = Date.parse(stoppedAtIso);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
    return 0;
  }
  return (stop - start) / 60000;
}

async function markEgressStopped(sb, egressId, nowIso) {
  if (!sb) {
    return;
  }
  // Csak az AKTÍV sort zárjuk (idempotens): ha a user-stop és a stale-sweep is
  // meghívja, csak az első active→stopped átmenet ad vissza sort → nincs dupla mérés.
  const { data } = await sb
    .from('live_egress')
    .update({ status: 'stopped', stopped_at: nowIso })
    .eq('egress_id', egressId)
    .eq('status', 'active')
    .select('user_id, started_at')
    .maybeSingle();
  // 📊 §2.2: a multistream felhő-perceit a `renderMinutes` kvótába könyveljük
  // (best-effort, a bizonyított /render-mintát követve; a trackUsage kerekít).
  if (data && data.user_id && data.started_at) {
    const minutes = egressMinutes(data.started_at, nowIso);
    if (minutes > 0) {
      void trackUsage(data.user_id, 'renderMinutes', minutes);
    }
  }
}

/** A `maxMinutes`-nél régebbi, még „active" egresseket leállítja + jelöli (lejárt). */
async function stopStale(sb, client, rows, nowIso) {
  for (const r of rows ?? []) {
    try {
      await client.stopEgress(r.egress_id);
    } catch {
      // lehet, hogy LiveKit-oldalon már nincs — a jelölés akkor is kell
    }
    await markEgressStopped(sb, r.egress_id, nowIso);
  }
  return (rows ?? []).length;
}

/** Egy user lejárt (túl hosszú) egresseinek lezárása indítás előtt. */
async function sweepUserStale(sb, client, userId, maxMinutes, nowMs) {
  if (!sb || !client) {
    return 0;
  }
  const cutoff = new Date(nowMs - maxMinutes * 60000).toISOString();
  const { data, error } = await sb
    .from('live_egress')
    .select('egress_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lt('started_at', cutoff);
  if (error) {
    return 0;
  }
  return stopStale(sb, client, data, new Date(nowMs).toISOString());
}

/** GLOBÁLIS söprés (periodikus timer hívja) — minden lejárt egresst leállít. */
async function sweepStaleEgress(nowMs = Date.now()) {
  const sb = getAdmin();
  const client = getEgressClient();
  if (!sb || !client) {
    return { swept: 0 };
  }
  const cutoff = new Date(nowMs - MAX_EGRESS_MINUTES() * 60000).toISOString();
  const { data, error } = await sb
    .from('live_egress')
    .select('egress_id')
    .eq('status', 'active')
    .lt('started_at', cutoff);
  if (error) {
    return { swept: 0 };
  }
  const swept = await stopStale(sb, client, data, new Date(nowMs).toISOString());
  if (swept > 0) {
    console.log(`[liveEgress] auto-stop: ${swept} lejárt egress (> ${MAX_EGRESS_MINUTES()} perc) leállítva.`);
  }
  return { swept };
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
  // 💰 F3: indítás előtt söpörjük a user lejárt (túl hosszú) adásait, majd a
  // párhuzamos-limit. A `-1` (tábla hiányzik) „megenged" degradál.
  const nowMs = Date.now();
  await sweepUserStale(sb, client, userId, MAX_EGRESS_MINUTES(), nowMs);
  const active = await countActiveEgress(sb, userId);
  const max = MAX_CONCURRENT_EGRESS();
  if (active >= 0 && active >= max) {
    return {
      ok: false,
      status: 429,
      error: `Már fut ${active} élő multistream (max ${max}). Állítsd le az előzőt az új indításhoz.`,
    };
  }
  // 🔐 F2: a tárolt kulcs titkosított (enc:v1:…) — CSAK itt, az egress-indításkor
  // fejtjük vissza (service_role + szerver-secret). Hibás/dekódolhatatlan kulcsot
  // kihagyunk, nehogy egy sérült cél megfogja az egész adást.
  let urls;
  try {
    urls = dests.map((d) => rtmpTarget(d.rtmp_url, decryptStreamKey(d.stream_key)));
  } catch (e) {
    return { ok: false, status: 500, error: `Stream-kulcs dekódolási hiba: ${e.message}` };
  }
  const streamOutput = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });
  // 📼 D158: ha a VOD aktív, a stream MELLÉ egy S3-MP4 fájl is készül (EncodedOutputs)
  const fileOutput = buildVodOutput(room);
  const output = fileOutput ? { stream: streamOutput, file: fileOutput } : streamOutput;
  try {
    // 🔑 a room LÉTEZZEN az egress előtt — a kliens-trigger a host csatlakozása
    // ELŐTT is futhat (race → „room does not exist" 404). A createRoom idempotens:
    // ha már van, nem gond; az egress így bevárja a hostot az (üres) szobában.
    const rc = getRoomClient();
    if (rc) {
      await rc.createRoom({ name: room, emptyTimeout: 300 }).catch(() => {});
    }
    // 🎥 168: scene-pontos kompozitor az egresshez. Ha az EGRESS_LAYOUT_URL be van
    // állítva (a worker `/live/egress-layout` route-ja, headless Chrome-ból elérhető
    // URL), a saját web-layout template rendereli a jelenetet (kamera+overlay a host
    // data-channel scene-állapotából) — különben a LiveKit beépített `grid` a fallback.
    const layoutUrl = (process.env.EGRESS_LAYOUT_URL || '').trim();
    const composite = layoutUrl
      ? { layout: 'remix', customBaseUrl: layoutUrl }
      : { layout: 'grid' };
    const info = await client.startRoomCompositeEgress(room, output, composite);
    // 💰 F3: felvesszük a tracking-táblába (best-effort) a limit + max-hossz méréséhez
    await recordEgress(sb, {
      egressId: info.egressId,
      userId,
      room,
      destinations: dests.length,
    });
    return {
      ok: true,
      egressId: info.egressId,
      destinations: dests.map((d) => ({ id: d.id, platform: d.platform, label: d.label })),
      vodUrl: vodUrl(room), // 📼 D158: a VOD publikus URL-je (vagy null, ha nincs VOD)
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
    await markEgressStopped(getAdmin(), egressId, new Date().toISOString()); // best-effort tracking
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 502, error: `Egress-leállítás hiba: ${e.message}` };
  }
}

/** Be van-e kötve az egress (a Studio ez alapján mutathatja a Pro-multistreamet). */
function egressConfigured() {
  return !!getEgressClient() && !!getAdmin();
}

module.exports = {
  startEgress,
  stopEgress,
  egressConfigured,
  sweepStaleEgress,
  // tesztekhez exportált tiszta-ish segédek:
  egressMinutes,
  countActiveEgress,
  sweepUserStale,
  stopStale,
  intEnv,
};
