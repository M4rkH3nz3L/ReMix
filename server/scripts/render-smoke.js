#!/usr/bin/env node
// 🎬 Render-parity SMOKE runner (dev-eszköz).
//
// Minden funkció-fixture-t (smokeFixtures.js) a FUTÓ render-API-val renderel, és
// a kész MP4-et egy mappába menti, hogy VIZUÁLISAN összevethesd a szerkesztő
// előnézetével (Preview == Export). A rövid (≤15 mp) projektek IN-PROCESS
// renderelnek a szerveren → NEM kell worker/queue/S3, csak a futó API + ffmpeg.
//
// Futtatás (a dev-API fusson a :8787-en, ALLOW_INSECURE_DEV=1):
//   node server/scripts/render-smoke.js
//   SMOKE_BASE=http://localhost:8787 node server/scripts/render-smoke.js
//
// Kimenet: <repo>/.render-smoke/<fixture>.mp4 + manifest.json
// FONTOS: a parity ELDÖNTÉSE emberi szem — ez a harness csak legenerálja az
// összevetendő exportokat; a vizuális ítélet a tiéd.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSmokeProjects, mediaUrisOf, SMOKE_MEDIA, W, H, FPS, DUR } = require('../smokeFixtures');

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
const OUT_DIR = path.join(__dirname, '..', '..', '.render-smoke');
const POLL_MS = 1000;
const MAX_POLLS = 120; // ~2 perc / fixture (rövid klip bőven elég)

function log(...a) {
  console.log('[smoke]', ...a);
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

/** Teszt-média legenerálása (egyszer) a szimbolikus uri-khoz → fájl-térkép. */
function generateMedia(dir) {
  const video = path.join(dir, 'video.mp4');
  const video2 = path.join(dir, 'video2.mp4');
  const audio = path.join(dir, 'audio.m4a');
  log('teszt-média generálása ffmpeg-gel…');
  ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}:duration=${DUR}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video]);
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${DUR}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video2]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:duration=${DUR}`, '-c:a', 'aac', audio]);
  return { [SMOKE_MEDIA.VIDEO]: video, [SMOKE_MEDIA.VIDEO2]: video2, [SMOKE_MEDIA.AUDIO]: audio };
}

async function renderOne(name, project, mediaFiles) {
  const form = new FormData();
  form.append('project', JSON.stringify(project));
  const uriMap = {};
  mediaUrisOf(project).forEach((uri, i) => {
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
  form.append('userId', 'smoke');
  form.append('tier', 'pro');

  const submit = await fetch(`${BASE}/render`, { method: 'POST', body: form });
  const submitBody = await submit.json().catch(() => ({}));
  if (!submit.ok || !submitBody.id) {
    throw new Error(`submit ${submit.status}: ${submitBody.error || 'ismeretlen hiba'}`);
  }
  const id = submitBody.id;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const s = await fetch(`${BASE}/render/${id}`).then((r) => r.json()).catch(() => ({}));
    if (s.state === 'done') {
      const fileRes = await fetch(`${BASE}/render/${id}/file`);
      if (!fileRes.ok) {
        throw new Error(`file ${fileRes.status}`);
      }
      const out = path.join(OUT_DIR, `${name}.mp4`);
      fs.writeFileSync(out, Buffer.from(await fileRes.arrayBuffer()));
      return { out, bytes: fs.statSync(out).size };
    }
    if (s.state === 'error') {
      throw new Error(s.error || 'render error');
    }
  }
  throw new Error('timeout (a job nem lett kész — fut a worker/API?)');
}

async function main() {
  // ffmpeg ellenőrzés
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('✗ ffmpeg nincs a PATH-ban — telepítsd (brew install ffmpeg).');
    process.exit(1);
  }
  // API health
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    log(`API: ${BASE} · render=${h.render} · cloudMin=${h.cloudRenderMinSec}s · workers=${h.workers ?? 'n/a'}`);
  } catch {
    console.error(`✗ a render-API nem elérhető: ${BASE} — indítsd el: cd server && npm start`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-media-'));
  const mediaFiles = generateMedia(mediaDir);

  const fixtures = buildSmokeProjects();
  const manifest = [];
  let ok = 0;
  for (const { name, description, project } of fixtures) {
    process.stdout.write(`[smoke] ${name} … `);
    try {
      const { out, bytes } = await renderOne(name, project, mediaFiles);
      console.log(`✓ (${Math.round(bytes / 1024)} KB)`);
      manifest.push({ name, description, file: path.basename(out), bytes, ok: true });
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      manifest.push({ name, description, ok: false, error: e.message });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results: manifest }, null, 2));
  try {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  log(`kész: ${ok}/${fixtures.length} rendben → ${OUT_DIR}`);
  log('Nézd végig a mappa MP4-jeit, és vesd össze a szerkesztő előnézetével (Preview == Export).');
  if (ok < fixtures.length) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[smoke] végzetes hiba:', e.message);
  process.exit(1);
});
