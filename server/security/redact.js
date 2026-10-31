// 🔐 PRO-LIVE L11 — titkok kitakarása naplóból, hibaüzenetből, hibajelentésből.
// Az RTMP(S) URL-ek útvonala (benne a stream-kulccsal) és a tipikus kulcs-minták
// soha nem kerülhetnek logba / Alertbe / bug-jelentésbe.

const PATTERNS = [
  // rtmp(s)://host/app/KULCS → rtmp(s)://host/***
  [/(rtmps?:\/\/[^/\s"'<>]+)\/[^\s"'<>]*/gi, '$1/***'],
  // gyakori stream-kulcs minták (YouTube xxxx-xxxx-xxxx-xxxx-xxxx, Twitch live_…, FB FB-…)
  [/\blive_[A-Za-z0-9_]{10,}/g, 'live_***'],
  [/\b[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/gi, '****-****-****-****-****'],
  [/\bFB-[A-Za-z0-9-]{10,}/g, 'FB-***'],
  // a titkosított tárolási forma
  [/enc:v1:[A-Za-z0-9+/=:._-]+/g, 'enc:v1:***'],
];

function redactSecrets(input) {
  if (input == null) return input;
  let s = typeof input === 'string' ? input : String(input);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

module.exports = { redactSecrets };
