// 🖥️ Dev-állapot dashboard — KÖZÖS „screen" a fejlesztéshez.
//
// Egyetlen, függőség nélküli Node-szerver, ami böngészőből (fejlesztő) ÉS
// `curl`-lel (agent) is nézhető. Szerver-oldalon (a Mac-en) ellenőrzi a
// szolgáltatások egészségét (Supabase / worker / Metro), mutatja a telefonos
// kapcsolódási URL-t, és a worker/Metro logok utolsó sorait. 3 mp-enként frissül.
//
// Indítás:  node scripts/devstatus.mjs
// Env:      LAN_IP, DASH_PORT (def 8899), SUPA_PORT (54421), WORKER_PORT (8787),
//           METRO_PORT (8081), WORKER_LOG, METRO_LOG
import http from 'node:http';
import { readFileSync } from 'node:fs';

const LAN_IP = process.env.LAN_IP || '127.0.0.1';
const PORT = Number(process.env.DASH_PORT || 8899);
const SUPA = Number(process.env.SUPA_PORT || 54421);
const WORKER = Number(process.env.WORKER_PORT || 8787);
const METRO = Number(process.env.METRO_PORT || 8081);
const WORKER_LOG = process.env.WORKER_LOG || '';
const METRO_LOG = process.env.METRO_LOG || '';

const SERVICES = [
  { key: 'supabase', label: 'Supabase', url: `http://127.0.0.1:${SUPA}/rest/v1/` },
  { key: 'worker', label: 'Worker', url: `http://127.0.0.1:${WORKER}/health` },
  { key: 'metro', label: 'Metro (Expo)', url: `http://127.0.0.1:${METRO}/status` },
];

async function ping(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(e?.message || e) };
  }
}

function tail(path, n = 40) {
  if (!path) return '(nincs log-útvonal)';
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    return lines.slice(-n).join('\n') || '(üres)';
  } catch {
    return '(a log még nem elérhető)';
  }
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function snapshot() {
  const checks = await Promise.all(SERVICES.map((s) => ping(s.url)));
  return SERVICES.map((s, i) => ({ ...s, ...checks[i] }));
}

function page(status) {
  const allUp = status.every((s) => s.ok);
  const expUrl = `exp://${LAN_IP}:${METRO}`;
  const pill = (s) => `
    <div class="card ${s.ok ? 'up' : 'down'}">
      <div class="dot"></div>
      <div class="meta">
        <div class="name">${esc(s.label)}</div>
        <div class="sub">${s.ok ? `HTTP ${s.status} · ${s.ms}ms` : esc(s.error || 'nem elérhető')}</div>
      </div>
    </div>`;
  return `<!doctype html><html lang="hu"><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="refresh" content="3"/>
  <title>ReMix dev — ${allUp ? '🟢 minden fut' : '🔴 hiba'}</title>
  <style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;font:15px -apple-system,system-ui,sans-serif;background:#07080d;color:#f4f5fa;padding:16px}
    h1{font-size:17px;margin:0 0 2px} .muted{color:#8d93a8;font-size:12px}
    .grid{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
    .card{display:flex;align-items:center;gap:10px;background:#111420;border:1px solid #252a3d;border-radius:12px;padding:12px 14px;min-width:180px}
    .card.up{border-color:#2ecc8f55} .card.down{border-color:#ff5c7255}
    .dot{width:10px;height:10px;border-radius:50%;background:#ff5c72}
    .up .dot{background:#2ecc8f;box-shadow:0 0 8px #2ecc8f}
    .name{font-weight:700} .sub{color:#8d93a8;font-size:12px;font-variant-numeric:tabular-nums}
    .connect{background:#111420;border:1px solid #252a3d;border-radius:14px;padding:16px;margin:14px 0}
    .url{font-size:20px;font-weight:800;color:#7c5cff;word-break:break-all}
    code{background:#1a1e2e;padding:2px 6px;border-radius:6px}
    .logs{display:flex;flex-wrap:wrap;gap:12px}
    .logbox{flex:1;min-width:320px}
    pre{background:#0c0d12;border:1px solid #252a3d;border-radius:10px;padding:10px;max-height:320px;overflow:auto;font-size:11px;line-height:1.4;color:#c7ccda}
    .banner{padding:10px 14px;border-radius:10px;font-weight:700;margin-bottom:8px}
    .banner.ok{background:#2ecc8f22;color:#2ecc8f} .banner.bad{background:#ff5c7222;color:#ff5c72}
  </style></head><body>
  <h1>🎬 ReMix — dev állapot</h1>
  <div class="muted">automatikusan frissül 3 mp-enként · ${new Date().toLocaleTimeString('hu-HU')}</div>
  <div class="banner ${allUp ? 'ok' : 'bad'}">${allUp ? '🟢 Minden szolgáltatás fut — tesztelhető' : '🔴 Valami nem fut — nézd a logokat'}</div>
  <div class="grid">${status.map(pill).join('')}</div>
  <div class="connect">
    <div class="muted">Kapcsolódás Expo Go-ban (azonos Wi-Fi) — „Enter URL manually":</div>
    <div class="url">${esc(expUrl)}</div>
    <div class="muted" style="margin-top:6px">Ez a dashboard: <code>http://${esc(LAN_IP)}:${PORT}</code> · gépi nézet: <code>/status.json</code></div>
  </div>
  <div class="logs">
    <div class="logbox"><h3>Worker log</h3><pre>${esc(tail(WORKER_LOG))}</pre></div>
    <div class="logbox"><h3>Metro log</h3><pre>${esc(tail(METRO_LOG))}</pre></div>
  </div>
  </body></html>`;
}

const server = http.createServer(async (req, res) => {
  const status = await snapshot();
  if (req.url && req.url.startsWith('/status.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ lanIp: LAN_IP, expUrl: `exp://${LAN_IP}:${METRO}`, services: status }, null, 2));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(status));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dev-status dashboard: http://${LAN_IP}:${PORT}  (helyi: http://127.0.0.1:${PORT})`);
});
