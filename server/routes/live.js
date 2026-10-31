// 🔴 Live (LiveKit) route-ok: access-token, multistream-egress, RTMP-kulcs, egress-layout.
//
// Domain-router (01-api-architecture §01.1). A handlerek + a resolveLivePublish helper
// SZÓ SZERINT az index.js-ből — a viselkedés változatlan (F1 host-ownership publish-
// döntés, F2 titkosított stream-kulcs, 503/401/400 hiba-precedencia megőrizve). A
// séma-validáció itt NEM kerül be: a handlerek a 503 (LiveKit-config) / 401 ellenőrzést
// a mező-ellenőrzés ELŐTT végzik.

const path = require('path');
const express = require('express');
const { AccessToken } = require('livekit-server-sdk');

const { callerId, requireAuth, INSECURE_DEV } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { startEgress, stopEgress } = require('../liveEgress');
const { encryptStreamKey, encryptionEnabled } = require('../liveCrypto');
const { adminClient } = require('../notify');
const { redactSecrets } = require('../security/redact');

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();

const router = express.Router();

/**
 * 🔐 F1 + PRO-LIVE L1/L9 — a token-döntés TELJESEN szerveroldali, a `live_sessions` sor ellen:
 *  • a szobának LÉTEZŐ, élő sessionnek kell lennie (bármilyen szoba-sztringre / befejezett
 *    adásra nincs token → 404 / 410);
 *  • publish (kamera/mikrofon + ADATCSATORNA) csak a hostnak — a néző nem küldhet adatot,
 *    így a jelenetet (és vele az RTMP-kimenetet) sem írhatja át;
 *  • DB-hiba → 503 (csak insecure-dev-ben enged tovább).
 * → { status, canPublish?, hostId?, error? }
 */
async function resolveLiveAccess(room, uid, requested) {
  const sb = adminClient();
  if (!sb) {
    return INSECURE_DEV ? { status: 200, canPublish: requested, hostId: null } : { status: 503, error: 'Nincs service_role a live-jogosultsághoz.' };
  }
  const { data, error } = await sb.from('live_sessions').select('host_id, status').eq('id', room).maybeSingle();
  if (error) {
    return INSECURE_DEV ? { status: 200, canPublish: requested, hostId: null } : { status: 503, error: 'A live session nem ellenőrizhető.' };
  }
  if (!data) {
    return { status: 404, error: 'Nincs ilyen élő adás.' };
  }
  if (data.status !== 'live') {
    return { status: 410, error: 'Az adás már véget ért.' };
  }
  return { status: 200, canPublish: requested && data.host_id === uid, hostId: data.host_id };
}

/** a megjelenítendő név a profilból (nem a kliens küldi → nincs megszemélyesítés) */
async function displayNameFor(uid) {
  const sb = adminClient();
  if (!sb) return uid.slice(0, 8);
  const { data } = await sb.from('profiles').select('full_name, username').eq('id', uid).maybeSingle();
  const n = (data?.full_name || data?.username || '').trim();
  return (n || uid.slice(0, 8)).slice(0, 80);
}

// 🔴 LiveKit access-token az élő-roomhoz.
router.post('/live/token', express.json({ limit: '4kb' }), requireAuth, rateLimit('messaging'), async (req, res) => {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    res.status(503).json({ error: 'LiveKit nincs konfigurálva (LIVEKIT_API_KEY / LIVEKIT_API_SECRET).' });
    return;
  }
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const room = String(req.body?.room || '').trim();
  if (!room) {
    res.status(400).json({ error: 'room kötelező.' });
    return;
  }
  if (room.length > 64 || !/^[A-Za-z0-9_-]+$/.test(room)) {
    res.status(400).json({ error: 'Érvénytelen room.' });
    return;
  }
  try {
    const access = await resolveLiveAccess(room, uid, req.body?.publish === true);
    if (access.status !== 200) {
      res.status(access.status).json({ error: access.error });
      return;
    }
    const canPublish = access.canPublish === true;
    const name = INSECURE_DEV && !adminClient() ? String(req.body?.name || uid).slice(0, 80) : await displayNameFor(uid);
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: uid, name, ttl: '2h' });
    // a néző CSAK feliratkozik: nincs publish, nincs adatküldés (L1)
    at.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true, canPublishData: canPublish });
    const token = await at.toJwt();
    res.json({ token, url: LIVEKIT_URL, canPublish });
  } catch (err) {
    res.status(500).json({ error: `Token-hiba: ${err.message}` });
  }
});

// 🎥 Multistream EGRESS (LIVE.md Fázis E) — PRO-only.
router.post('/live/egress/start', express.json({ limit: '4kb' }), ...proOnly, rateLimit('messaging'), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const room = String(req.body?.room || '').trim();
  if (!room) {
    res.status(400).json({ error: 'room kötelező.' });
    return;
  }
  const record = req.body?.record === true || req.body?.record === 'true';
  const aspect = typeof req.body?.aspect === 'string' ? req.body.aspect : undefined;
  const result = await startEgress({ room, userId: uid, record, aspect });
  // 🔎 dev-diagnosztika (KITAKARVA: az egress-hiba RTMP-URL-t / kulcsot tartalmazhat — L11)
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[egress/start] room=${room.slice(0, 8)} record=${record} → ok=${result.ok} status=${result.status || 200}${result.ok ? '' : ' err=' + redactSecrets(result.error)}`,
    );
  }
  if (!result.ok) {
    res.status(result.status || 500).json({ error: result.error });
    return;
  }
  res.json({ egressId: result.egressId, destinations: result.destinations, skipped: result.skipped ?? [], vodUrl: result.vodUrl ?? null });
});

router.post('/live/egress/stop', express.json({ limit: '2kb' }), ...proOnly, rateLimit('messaging'), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const egressId = String(req.body?.egressId || '').trim();
  if (!egressId) {
    res.status(400).json({ error: 'egressId kötelező.' });
    return;
  }
  // 🔐 L3: csak a SAJÁT egress állítható le (idegennél 404 — a létezését se áruljuk el)
  const owner = await egressOwner(egressId);
  if (owner.status !== 200 || (owner.userId !== uid && !(INSECURE_DEV && owner.userId === null))) {
    res.status(owner.status === 503 ? 503 : 404).json({ error: owner.status === 503 ? owner.error : 'Ismeretlen egress.' });
    return;
  }
  const result = await stopEgress(egressId);
  if (!result.ok) {
    res.status(result.status || 500).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

// 🔐 F2 — RTMP stream-kulcs beállítása TITKOSÍTVA.
router.post('/live/destinations/set-key', express.json({ limit: '2kb' }), requireAuth, rateLimit('messaging'), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  if (!uid) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const destinationId = String(req.body?.destinationId || '').trim();
  const streamKey = String(req.body?.streamKey || '').trim();
  if (!destinationId || !streamKey) {
    res.status(400).json({ error: 'destinationId és streamKey kötelező.' });
    return;
  }
  if (streamKey.length > 512) {
    res.status(400).json({ error: 'Túl hosszú stream-kulcs.' });
    return;
  }
  const sb = adminClient();
  if (!sb) {
    res.status(503).json({ error: 'Nincs service_role konfigurálva a kulcs-tároláshoz.' });
    return;
  }
  const { data: dest, error: readErr } = await sb
    .from('live_destinations')
    .select('user_id')
    .eq('id', destinationId)
    .maybeSingle();
  if (readErr) {
    res.status(500).json({ error: readErr.message });
    return;
  }
  if (!dest || dest.user_id !== uid) {
    res.status(403).json({ error: 'Nem a te célod.' });
    return;
  }
  const { error: updErr } = await sb
    .from('live_destinations')
    .update({ stream_key: encryptStreamKey(streamKey) })
    .eq('id', destinationId);
  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }
  res.json({ ok: true, encrypted: encryptionEnabled() });
});

// 🎥 LIVE.md 168 — Egress web-layout template (scene-pontos kompozitor). PUBLIKUS GET.
/** az egress tulajdonosa a tracking-táblából → { status, userId?, error? } */
async function egressOwner(egressId) {
  const sb = adminClient();
  if (!sb) return INSECURE_DEV ? { status: 200, userId: null } : { status: 503, error: 'Nincs service_role.' };
  const { data, error } = await sb.from('live_egress').select('user_id').eq('egress_id', egressId).maybeSingle();
  if (error) return { status: 503, error: 'Az egress nem ellenőrizhető.' };
  if (!data) return { status: 404 };
  return { status: 200, userId: data.user_id };
}

router.get('/live/egress-layout', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'egressLayout.html'));
});

module.exports = router;
module.exports.resolveLiveAccess = resolveLiveAccess;
