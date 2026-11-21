// 💰 LiveKit Egress — a `live_egress` tracking-tábla: limit, lezárás, perc-mérés, lejárt-söprés.
const { logCaught } = require('../lib/caught');
const { redactSecrets } = require('../security/redact');
const { trackUsage } = require('../usage');
const { getEgressClient, getAdmin } = require('./clients');

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
    console.warn(`[liveEgress] tracking-insert nem sikerült (best-effort): ${redactSecrets(error.message)}`);
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
    } catch (caught) {
      logCaught('liveEgress.js:stopStale', caught);
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

module.exports = {
  intEnv,
  MAX_CONCURRENT_EGRESS,
  MAX_EGRESS_MINUTES,
  countActiveEgress,
  recordEgress,
  egressMinutes,
  markEgressStopped,
  stopStale,
  sweepUserStale,
  sweepStaleEgress,
};
