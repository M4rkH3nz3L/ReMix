#!/usr/bin/env node
// ⏱️ /imagedoc render-idő MÉRÉS a réteg-szám függvényében (dev-eszköz).
//
// A /imagedoc RÉTEGENKÉNT egy Chromium-screenshotot készít + ffmpeg-kompozit, így a
// render-idő a réteg-számmal nő. Ez a script megméri a borítékot (ms + ms/réteg),
// hogy a nagy-doc GUARD plafonja (imageDocGuard: ≤400 réteg) reális legyen, és hogy
// a prod render-idő-várakozás kiszámítható legyen.
//
// Futtatás (a dev-API fusson, ALLOW_INSECURE_DEV=1):
//   node server/scripts/imagedoc-perf.js
//   SMOKE_BASE=http://localhost:8788 PERF_COUNTS=1,10,50,100,200,400 node server/scripts/imagedoc-perf.js

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
const COUNTS = (process.env.PERF_COUNTS || '1,10,50,100,200,400').split(',').map((x) => parseInt(x, 10)).filter(Boolean);
const HEIGHT = Math.max(240, Math.min(2160, Number(process.env.PERF_HEIGHT) || 720));

function log(...a) {
  console.log('[perf]', ...a);
}

/** N darab, egymástól eltérő forma-réteg (külön Chromium-screenshot mindegyik) */
function docWithShapes(n) {
  const layers = [{ kind: 'fill', id: 'bg', fill: '#101018' }];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n);
    layers.push({
      kind: 'shape',
      id: `s${i}`,
      shape: i % 2 === 0 ? 'rectangle' : 'ellipse',
      position: { x: 0.1 + 0.8 * ((i * 97) % 100) / 100, y: 0.1 + 0.8 * ((i * 53) % 100) / 100 },
      w: 0.12,
      h: 0.12,
      fill: `hsl(${Math.round(t * 360)} 70% 55%)`,
      opacity: 0.9,
    });
  }
  return { id: `perf-${n}`, name: `P${n}`, aspectRatio: '1:1', width: 720, height: 720, layers };
}

async function timeOne(n) {
  const form = new FormData();
  form.append('doc', JSON.stringify(docWithShapes(n)));
  form.append('uriMap', '{}');
  form.append('height', String(HEIGHT));
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${BASE}/imagedoc`, { method: 'POST', body: form });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!res.ok) {
    const body = buf ? '' : await res.json().catch(() => ({}));
    return { n, ok: false, ms, status: res.status, error: (body && body.error) || '' };
  }
  return { n, ok: true, ms, bytes: buf.length };
}

async function main() {
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    log(`API: ${BASE} · render=${h.render} · height=${HEIGHT}px · counts=${COUNTS.join(',')}`);
  } catch {
    console.error(`✗ az API nem elérhető: ${BASE} — indítsd: cd server && ALLOW_INSECURE_DEV=1 npm start`);
    process.exit(1);
  }
  log('réteg | render (ms) | ms/réteg | kimenet');
  const rows = [];
  for (const n of COUNTS) {
    const r = await timeOne(n);
    rows.push(r);
    if (r.ok) {
      log(`${String(n).padStart(5)} | ${r.ms.toFixed(0).padStart(11)} | ${(r.ms / n).toFixed(1).padStart(8)} | ${Math.round(r.bytes / 1024)} KB`);
    } else {
      log(`${String(n).padStart(5)} | ${r.ms.toFixed(0).padStart(11)} | ${'—'.padStart(8)} | ✗ HTTP ${r.status} ${r.error}`);
    }
  }
  const okRows = rows.filter((r) => r.ok);
  if (okRows.length >= 2) {
    const first = okRows[0];
    const last = okRows[okRows.length - 1];
    const perLayer = (last.ms - first.ms) / Math.max(1, last.n - first.n);
    log(`~ marginális réteg-költség: ${perLayer.toFixed(1)} ms/réteg; a 400-as plafon ~${Math.round((first.ms + perLayer * 400) / 1000)}s köré esik`);
  }
}

main().catch((e) => {
  console.error('[perf] végzetes hiba:', e.message);
  process.exit(1);
});
