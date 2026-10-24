/**
 * 📲 Átviteli tár — tiszta helperek (függőség nélkül, tesztelhetően):
 * kulcs-biztonságos projekt-id + lazy TTL döntés. A route (routes/transfer.js)
 * ezekre épül; a kliens-oldali tükör a src/lib/transferClient.ts TTL-je.
 */

const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

/** a projekt-id csak biztonságos karakterekkel mehet kulcsba/queryba */
function sanitizeProjectId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

/** lejárt-e a csomag (hibás/hiányzó időbélyeg = lejárt — sosem tágabb a bizonytalan) */
function isTransferExpired(createdAtIso, nowMs = Date.now()) {
  const t = Date.parse(createdAtIso || '');
  return !Number.isFinite(t) || nowMs - t > TRANSFER_TTL_MS;
}

module.exports = { TRANSFER_TTL_MS, sanitizeProjectId, isTransferExpired };
