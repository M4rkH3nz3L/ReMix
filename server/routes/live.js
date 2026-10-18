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

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();

const router = express.Router();

// 🔐 F1 — a `publish` szerepet a SZERVER dönti a `live_sessions.host_id` ellen, NEM a
// kliens: aki publish-t kér, de nem a szoba hostja, néző-tokent kap (canPublish:false).
async function resolveLivePublish(room, uid, requested) {
  if (!requested) {
    return false;
  }
  const sb = adminClient();
  if (!sb) {
    return INSECURE_DEV;
  }
  const { data, error } = await sb
    .from('live_sessions')
    .select('host_id')
    .eq('id', room)
    .maybeSingle();
  if (error || !data) {
    return INSECURE_DEV;
  }
  return data.host_id === uid;
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
  const name = String(req.body?.name || uid).slice(0, 80);
  try {
    const canPublish = await resolveLivePublish(room, uid, req.body?.publish === true);
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: uid, name, ttl: '2h' });
    at.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true, canPublishData: true });
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
  // 🔎 dev-diagnosztika: record-flag + az egress-indítás kimenete (VOD-debughoz)
  console.log(
    `[egress/start] room=${room.slice(0, 8)} record=${record} → ok=${result.ok} status=${result.status || 200} vod=${result.vodUrl ? 'yes' : 'no'}${result.ok ? '' : ' err=' + result.error}`,
  );
  if (!result.ok) {
    res.status(result.status || 500).json({ error: result.error });
    return;
  }
  res.json({ egressId: result.egressId, destinations: result.destinations, vodUrl: result.vodUrl ?? null });
});

router.post('/live/egress/stop', express.json({ limit: '2kb' }), ...proOnly, async (req, res) => {
  const egressId = String(req.body?.egressId || '').trim();
  if (!egressId) {
    res.status(400).json({ error: 'egressId kötelező.' });
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
router.get('/live/egress-layout', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'egressLayout.html'));
});

module.exports = router;
