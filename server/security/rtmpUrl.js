// @ts-check
const { logCaught } = require('../lib/caught');
// 🔐 PRO-LIVE L7 — RTMP(S) cél-URL validáció (SSRF elleni védelem).
//
// Az egress a user által megadott URL-re pushol: belső hálózati / loopback / link-local /
// felhő-metadata címre küldve a szerver belső szolgáltatásait érhetné el. Itt:
//  • csak rtmp:// vagy rtmps:// séma, hitelesítő adat nélkül, ésszerű porton;
//  • IP-literál esetén a privát/fenntartott tartományok tiltva;
//  • a `resolveSafe` a hostnevet DNS-sel is feloldja (DNS-rebinding ellen), és ha BÁRMELY
//    feloldott cím privát, elutasít.

const dns = require('dns').promises;
const net = require('net');

const ALLOWED_PORTS = new Set([1935, 1936, 443, 80, 8443, 4443]);

/**
 * privát / fenntartott / belső IPv4 vagy IPv6 cím-e
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local + felhő-metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + fenntartott
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // ULA
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]);
    // a WHATWG URL a [::ffff:127.0.0.1] literált hex alakra normalizálja (::ffff:7f00:1) → visszaalakítva
    // ugyanúgy a v4-szabály dönt; minden más ::ffff:-alak tiltott (fail-closed)
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (v.startsWith('::ffff:')) return true;
    return false;
  }
  return true;
}

/**
 * A cél-URL ellenőrzésének eredménye.
 * @typedef {{ok: true, host: string} | {ok: false, error: string}} RtmpCheck
 */

/**
 * szintaktikai + statikus ellenőrzés (DNS nélkül) → { ok, host?, error? }
 * @param {unknown} raw
 * @returns {RtmpCheck}
 */
function validateRtmpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 1024) return { ok: false, error: 'Üres vagy túl hosszú RTMP-cím.' };
  let u;
  try {
    u = new URL(s);
  } catch (caught) {
    logCaught('security/rtmpUrl.js:validateRtmpUrl', caught);
    return { ok: false, error: 'Érvénytelen RTMP-cím.' };
  }
  if (u.protocol !== 'rtmp:' && u.protocol !== 'rtmps:') {
    return { ok: false, error: 'Csak rtmp:// vagy rtmps:// cím adható meg.' };
  }
  if (u.username || u.password) return { ok: false, error: 'Az RTMP-cím nem tartalmazhat felhasználót/jelszót.' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'Belső hálózati cím nem adható meg.' };
  }
  if (net.isIP(host) && isPrivateIp(host)) return { ok: false, error: 'Belső hálózati cím nem adható meg.' };
  const port = u.port ? Number(u.port) : u.protocol === 'rtmps:' ? 443 : 1935;
  if (!ALLOWED_PORTS.has(port)) return { ok: false, error: `Nem engedélyezett port: ${port}.` };
  return { ok: true, host };
}

/**
 * teljes ellenőrzés DNS-feloldással (az egress-indítás előtt)
 * @param {unknown} raw
 * @param {(host: string) => Promise<Array<{address: string}>>} [lookup]
 * @returns {Promise<RtmpCheck>}
 */
async function resolveSafe(raw, lookup = (h) => dns.lookup(h, { all: true })) {
  const v = validateRtmpUrl(raw);
  if (!v.ok) return v;
  if (net.isIP(v.host)) return v;
  try {
    const addrs = await lookup(v.host);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return { ok: false, error: 'Az RTMP-cél belső hálózatra mutat.' };
    }
    return v;
  } catch (caught) {
    logCaught('security/rtmpUrl.js:resolveSafe', caught);
    return { ok: false, error: 'Az RTMP-cél hostja nem oldható fel.' };
  }
}

module.exports = { validateRtmpUrl, resolveSafe, isPrivateIp };
