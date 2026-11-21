// 🎥 LiveKit Egress — indítás (host-ownership, RTMP-célok, VOD, limit) és leállítás.
const { logCaught } = require('../lib/caught');
const { StreamOutput, StreamProtocol, EncodingOptions } = require('livekit-server-sdk');
const { resolveSafe } = require('../security/rtmpUrl');
const { redactSecrets } = require('../security/redact');
const { decryptStreamKey } = require('../liveCrypto');
const { getEgressClient, getRoomClient, getAdmin } = require('./clients');
const { vodName, vodUrl, buildVodOutput } = require('./vod');
const { MAX_CONCURRENT_EGRESS, MAX_EGRESS_MINUTES, countActiveEgress, recordEgress, markEgressStopped, sweepUserStale } = require('./tracking');

/** `rtmp://host/app` + `kulcs` → `rtmp://host/app/kulcs` (a teljes ingest-URL). */
function rtmpTarget(rtmpUrl, streamKey) {
  const base = String(rtmpUrl).replace(/\/+$/, '');
  return streamKey ? `${base}/${streamKey}` : base;
}

/**
 * Egress indítása a `userId` ENGEDÉLYEZETT céljaira. A `room` a LiveKit-szoba neve
 * (= a live_session id, mert a token room-ja az). Siker: `{ ok, egressId, destinations }`.
 */
/**
 * 📐 A live aspect-arányából az egress-kimenet mérete (páros, H.264-barát). Enélkül
 * a RoomComposite fix landscape-et ad → a portré-telefon-live „nem stimmel".
 * A kliens a live-projekt `aspectRatio`-ját küldi; ismeretlen → 16:9 fallback.
 */
function egressDimensions(aspect) {
  switch (aspect) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 720, height: 720 };
    case '4:5':
      return { width: 864, height: 1080 };
    case '4:3':
      return { width: 960, height: 720 };
    case '16:9':
    default:
      return { width: 1280, height: 720 };
  }
}

async function startEgress({ room, userId, record, aspect }) {
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
  // 🔐 L7: csak érvényes, NEM belső hálózatra mutató rtmp(s) cél (DNS-sel is ellenőrizve);
  // a hibás célt kihagyjuk (a többi megy), és a válaszban jelezzük
  const candidates = (data ?? []).filter((d) => d.rtmp_url && d.stream_key);
  const dests = [];
  const skipped = [];
  for (const d of candidates) {
    const check = await resolveSafe(d.rtmp_url);
    if (check.ok) dests.push(d);
    else skipped.push({ id: d.id, label: d.label, error: check.error });
  }
  // 📼 record-only: a VOD-fájl RTMP-cél NÉLKÜL is készülhet (ha a user rögzít +
  //    EGRESS_VOD+S3 áll). Így az egress csak-felvételre is elindul (nem csak
  //    multistreamre). A `record` a kliensből jön (a Live „Rögzítés" kapcsoló).
  const vodObject = vodName(room);
  const fileOutput = record ? buildVodOutput(vodObject) : null;
  if (dests.length === 0 && !fileOutput) {
    return {
      ok: false,
      status: 400,
      error: 'Nincs sem engedélyezett RTMP-cél, sem VOD-felvétel (record + EGRESS_VOD + S3 kell).',
    };
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
  let streamOutput = null;
  if (dests.length > 0) {
    let urls;
    try {
      urls = dests.map((d) => rtmpTarget(d.rtmp_url, decryptStreamKey(d.stream_key)));
    } catch (e) {
      logCaught('liveEgress.js:startEgress', e);
      return { ok: false, status: 500, error: `Stream-kulcs dekódolási hiba: ${redactSecrets(e.message)}` };
    }
    streamOutput = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });
  }
  // 📼 D158: multistream (stream) + felvétel (file) tetszőleges kombinációja.
  //    Csak-felvétel → { file }; csak-multistream → stream; mindkettő → { stream, file }.
  const output =
    streamOutput && fileOutput
      ? { stream: streamOutput, file: fileOutput }
      : streamOutput
        ? streamOutput
        : { file: fileOutput };
  try {
    // 🔑 a room LÉTEZZEN az egress előtt — a kliens-trigger a host csatlakozása
    // ELŐTT is futhat (race → „room does not exist" 404). A createRoom idempotens:
    // ha már van, nem gond; az egress így bevárja a hostot az (üres) szobában.
    const rc = getRoomClient();
    if (rc) {
      await rc.createRoom({ name: room, emptyTimeout: 300 }).catch((caught) => { logCaught('liveEgress.js:startEgress', caught); });
    }
    // 🎥 168: scene-pontos kompozitor az egresshez. Ha az EGRESS_LAYOUT_URL be van
    // állítva (a worker `/live/egress-layout` route-ja, headless Chrome-ból elérhető
    // URL), a saját web-layout template rendereli a jelenetet (kamera+overlay a host
    // data-channel scene-állapotából) — különben a LiveKit beépített `grid` a fallback.
    const layoutUrl = (process.env.EGRESS_LAYOUT_URL || '').trim();
    // 📐 a kimenet mérete a live aspect-arányához (különben fix landscape → „nem stimmel")
    const dims = egressDimensions(aspect);
    const encodingOptions = new EncodingOptions({ width: dims.width, height: dims.height, framerate: 30 });
    // 🔐 L1: a sablon CSAK a host jelenetét/kameráját fogadja el → a host-id a sablon URL-jében
    const hostLayoutUrl = layoutUrl ? `${layoutUrl}${layoutUrl.includes('?') ? '&' : '?'}host=${encodeURIComponent(userId)}` : '';
    const composite = layoutUrl
      ? { layout: 'remix', customBaseUrl: hostLayoutUrl, encodingOptions }
      : { layout: 'grid', encodingOptions };
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
      skipped,
      vodUrl: fileOutput ? vodUrl(vodObject) : null, // 📼 D158: a VOD publikus URL-je (csak ha készül felvétel)
    };
  } catch (e) {
    logCaught('liveEgress.js:startEgress', e);
    return { ok: false, status: 502, error: `Egress-indítás hiba: ${redactSecrets(e.message)}` };
  }
}

async function stopEgress(egressId) {
  const client = getEgressClient();
  if (!client) {
    return { ok: false, status: 503, error: 'LiveKit Egress nincs konfigurálva.' };
  }
  // ⚠️ a tracking-sort AKKOR IS lezárjuk, ha a LiveKit-stop dob (pl. a már
  // EGRESS_FAILED egresst „nem lehet leállítani" → 412): az egress így is „vége",
  // és ha a sort nem zárnánk, örökre a párhuzamos-limit ellen számítana (429).
  let stopErr = null;
  try {
    await client.stopEgress(egressId);
  } catch (e) {
    logCaught('liveEgress.js:stopEgress', e);
    stopErr = e;
  }
  await markEgressStopped(getAdmin(), egressId, new Date().toISOString()).catch((caught) => { logCaught('liveEgress.js:stopEgress', caught); }); // best-effort tracking
  return stopErr ? { ok: false, status: 502, error: `Egress-leállítás hiba: ${redactSecrets(stopErr.message)}` } : { ok: true };
}

/** Be van-e kötve az egress (a Studio ez alapján mutathatja a Pro-multistreamet). */
function egressConfigured() {
  return !!getEgressClient() && !!getAdmin();
}

module.exports = { rtmpTarget, egressDimensions, startEgress, stopEgress, egressConfigured };
