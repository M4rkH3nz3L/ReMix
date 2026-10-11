#!/usr/bin/env node
// 🎨 Image-rasterize parity SMOKE runner (dev-eszköz).
//
// Minden funkció-fixture-t (smokeImageFixtures.js) a FUTÓ API `/imagedoc`-jával
// PNG-be raszterizál, és egy mappába ment, hogy VIZUÁLISAN összevethesd a
// szerkesztő-előnézettel (Preview == Export). Az `/imagedoc` IN-PROCESS fut az
// API-n (nincs queue/worker/S3) → csak a futó API + Chromium (a worker-image-ben)
// kell. Dev-ben ALLOW_INSECURE_DEV=1 mellett auth nélkül megy.
//
// Futtatás (a dev-API fusson a :8787-en, ALLOW_INSECURE_DEV=1):
//   node server/scripts/imagedoc-smoke.js
//   SMOKE_BASE=http://localhost:8787 SMOKE_HEIGHT=1280 node server/scripts/imagedoc-smoke.js
//
// Kimenet: <repo>/.imagedoc-smoke/<fixture>.png + manifest.json
// FONTOS: a parity ELDÖNTÉSE emberi szem — ez a harness csak legenerálja az
// összevetendő exportokat; a vizuális ítélet a tiéd.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSmokeDocs, mediaUrisOf, SMOKE_IMAGE_MEDIA, W, H } = require('../smokeImageFixtures');

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
const HEIGHT = Math.max(240, Math.min(2160, Number(process.env.SMOKE_HEIGHT) || H));
const OUT_DIR = path.join(__dirname, '..', '..', '.imagedoc-smoke');

function log(...a) {
  console.log('[imgsmoke]', ...a);
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

/** Teszt-fotó legenerálása (egyszer) a szimbolikus PHOTO-uri-hoz → fájl. */
function generatePhoto(dir) {
  const photo = path.join(dir, 'photo.png');
  log('teszt-fotó generálása ffmpeg-gel…');
  // testsrc2 = színes, felismerhető minta → forgatás/tükrözés/crop jól látszik
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=1:duration=1`, '-frames:v', '1', photo]);
  return { [SMOKE_IMAGE_MEDIA.PHOTO]: photo };
}

async function rasterizeOne(name, doc, mediaFiles) {
  const form = new FormData();
  form.append('doc', JSON.stringify(doc));
  const uriMap = {};
  mediaUrisOf(doc).forEach((uri, i) => {
    const field = `f${i}`;
    uriMap[uri] = field;
    const file = mediaFiles[uri];
    if (!file) {
      throw new Error(`nincs média a(z) ${uri} uri-hoz`);
    }
    const buf = fs.readFileSync(file);
    form.append(field, new Blob([buf]), path.basename(file));
  });
  form.append('uriMap', JSON.stringify(uriMap));
  form.append('height', String(HEIGHT));

  const res = await fetch(`${BASE}/imagedoc`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${body.error || 'ismeretlen hiba'}`);
  }
  const out = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return { out, bytes: fs.statSync(out).size };
}

async function main() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('✗ ffmpeg nincs a PATH-ban — telepítsd (brew install ffmpeg).');
    process.exit(1);
  }
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    log(`API: ${BASE} · render=${h.render} · height=${HEIGHT}px`);
  } catch {
    console.error(`✗ az API nem elérhető: ${BASE} — indítsd el: cd server && ALLOW_INSECURE_DEV=1 npm start`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgsmoke-media-'));
  const mediaFiles = generatePhoto(mediaDir);

  const fixtures = buildSmokeDocs();
  const manifest = [];
  let ok = 0;
  for (const { name, description, doc } of fixtures) {
    process.stdout.write(`[imgsmoke] ${name} … `);
    try {
      const { out, bytes } = await rasterizeOne(name, doc, mediaFiles);
      console.log(`✓ (${Math.round(bytes / 1024)} KB)`);
      manifest.push({ name, description, file: path.basename(out), bytes, ok: true });
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      manifest.push({ name, description, ok: false, error: e.message });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ base: BASE, height: HEIGHT, at: new Date().toISOString(), results: manifest }, null, 2),
  );
  try {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  log(`kész: ${ok}/${fixtures.length} rendben → ${OUT_DIR}`);
  log('Nézd végig a mappa PNG-jeit, és vesd össze a szerkesztő előnézetével (Preview == Export).');
  if (ok < fixtures.length) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[imgsmoke] végzetes hiba:', e.message);
  process.exit(1);
});
