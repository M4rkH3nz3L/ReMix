// 🩹 LiveKit Egress — a DB-állapot egyeztetése a LiveKit valós egress-állapotával (beragadt session, árva egress).
const { logCaught } = require('../lib/caught');
const { getEgressClient, getAdmin } = require('./clients');
const { markEgressStopped } = require('./tracking');

// ── 🩹 PRO-LIVE L14/L16: valós állapot-egyeztetés ─────────────────────────────
/** ennél régebbi heartbeat = beragadt (crash / app-kill) session */
const LIVE_STALE_MS = 3 * 60 * 1000;
/** a heartbeat-oszlop előtti sémán: ennél régebben indult „live" session szellemnek számít */
const LIVE_LEGACY_MAX_MS = 12 * 60 * 60 * 1000;
/** a LiveKit EgressStatus: COMPLETE / FAILED / ABORTED / LIMIT_REACHED = véget ért */
const egressEnded = (status) => typeof status === 'number' && status >= 3;

/**
 * A szerveres „igazság" visszaírása a DB-be:
 *  1) a heartbeat nélküli élő sessionök lezárása (a host következő adása így nem bukik el);
 *  2) az aktív `live_egress` sorok egyeztetése a LiveKittel — a már véget ért egress sorát
 *     lezárjuk (különben a következő adás 429-et kapna és túlszámláznánk), a befejezett
 *     sessionhöz tartozó, még futó egresst pedig leállítjuk (árva egress).
 */
async function reconcileLive(nowMs = Date.now(), deps = {}) {
  const sb = deps.sb !== undefined ? deps.sb : getAdmin();
  if (!sb) {
    return { endedSessions: 0, closedEgress: 0, stoppedEgress: 0 };
  }
  const nowIso = new Date(nowMs).toISOString();
  let endedSessions = 0;
  const staleIso = new Date(nowMs - LIVE_STALE_MS).toISOString();
  let res = await sb.from('live_sessions').update({ status: 'ended' }).eq('status', 'live').lt('last_heartbeat', staleIso).select('id');
  if (res.error && /last_heartbeat/.test(res.error.message)) {
    const legacyIso = new Date(nowMs - LIVE_LEGACY_MAX_MS).toISOString();
    res = await sb.from('live_sessions').update({ status: 'ended' }).eq('status', 'live').lt('started_at', legacyIso).select('id');
  }
  endedSessions = res.data?.length ?? 0;

  let closedEgress = 0;
  let stoppedEgress = 0;
  const client = deps.client !== undefined ? deps.client : getEgressClient();
  const { data: rows } = await sb.from('live_egress').select('egress_id, room').eq('status', 'active');
  for (const r of rows ?? []) {
    let info = null;
    if (client) {
      try {
        [info] = await client.listEgress({ egressId: r.egress_id });
      } catch (caught) {
        logCaught('liveEgress.js:reconcileLive', caught);
        info = undefined; // a LiveKit most nem válaszol → ebben a körben nem döntünk
      }
    }
    if (info === undefined) continue;
    if (!info || egressEnded(info.status)) {
      // a LiveKit szerint már nem fut → a sor lezárása (a mérés a lezárás idejével)
      await markEgressStopped(sb, r.egress_id, nowIso);
      closedEgress++;
      continue;
    }
    const { data: sess } = await sb.from('live_sessions').select('status').eq('id', r.room).maybeSingle();
    if (sess && sess.status !== 'live') {
      try {
        await client.stopEgress(r.egress_id);
      } catch (caught) {
        logCaught('liveEgress.js:reconcileLive', caught);
        // már leállt — a jelölés akkor is kell
      }
      await markEgressStopped(sb, r.egress_id, nowIso);
      stoppedEgress++;
    }
  }
  if (endedSessions + closedEgress + stoppedEgress > 0) {
    console.log(`[liveEgress] egyeztetés: ${endedSessions} beragadt session lezárva, ${closedEgress} véget ért + ${stoppedEgress} árva egress lezárva.`);
  }
  return { endedSessions, closedEgress, stoppedEgress };
}

module.exports = { reconcileLive };
