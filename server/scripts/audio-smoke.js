#!/usr/bin/env node
// 🎧 Audio export-parity SMOKE runner (dev-eszköz).
//
// Minden funkció-fixture-t (smokeAudioFixtures.js) a FUTÓ render-API-val renderel
// WAV-ba (settings.audioFormat='wav'), majd MÉRI a kimenetet (hossz / Integrated
// LUFS / True-Peak / csatorna-RMS), hogy az EXPORT hangzása IGAZOLHATÓAN a várt
// legyen. A rövid (≤15 mp) projektek IN-PROCESS renderelnek → NEM kell worker/queue/S3.
//
// Futtatás (a dev-API fusson a :8787-en, ALLOW_INSECURE_DEV=1):
//   node server/scripts/audio-smoke.js
//   SMOKE_BASE=http://localhost:8788 node server/scripts/audio-smoke.js
//
// Kimenet: <repo>/.audio-smoke/<fixture>.wav + manifest.json
// A parity ELDÖNTÉSE emberi FÜL + a mért LUFS/TP — ez a harness legenerálja és megméri.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSmokeProjects, mediaUrisOf, SMOKE_AUDIO, DUR } = require('../smokeAudioFixtures');

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
const OUT_DIR = path.join(__dirname, '..', '..', '.audio-smoke');
const POLL_MS = 1000;
const MAX_POLLS = 120;
// a kimeneti formátum/minőség a méréshez: alap WAV (pontos LUFS); felülírható
// (pl. SMOKE_AUDIO_FORMAT=opus SMOKE_AUDIO_SR=48000 SMOKE_AUDIO_CH=1 → opus/mono/48k verifikáció)
const FMT = (process.env.SMOKE_AUDIO_FORMAT || 'wav').toLowerCase();
const SR = process.env.SMOKE_AUDIO_SR ? Number(process.env.SMOKE_AUDIO_SR) : undefined;
const CH = process.env.SMOKE_AUDIO_CH ? Number(process.env.SMOKE_AUDIO_CH) : undefined;
const FMT_EXT = { wav: 'wav', mp3: 'mp3', aac: 'm4a', flac: 'flac', opus: 'opus' };
const EXT = FMT_EXT[FMT] || 'wav';

function log(...a) {
  console.log('[asmoke]', ...a);
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

/** teszt-hang (egyszer) a szimbolikus uri-khoz → fájl-térkép */
function generateMedia(dir) {
  const mk = (name, freq, dur) => {
    const f = path.join(dir, `${name}.m4a`);
    ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, '-c:a', 'aac', '-b:a', '256k', f]);
    return f;
  };
  log('teszt-hang generálása ffmpeg-gel…');
  return {
    [SMOKE_AUDIO.MUSIC]: mk('music', 220, DUR),
    [SMOKE_AUDIO.VOICE]: mk('voice', 660, DUR),
    [SMOKE_AUDIO.SFX]: mk('sfx', 440, 1),
  };
}

// ── mérés ────────────────────────────────────────────────────────────────────

/** hossz (mp) + csatorna-szám + codec + sample-rate */
function probe(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=channels,codec_name,sample_rate', '-of', 'json', file,
  ]).toString();
  const j = JSON.parse(out);
  const s = (j.streams && j.streams[0]) || {};
  return {
    durationSec: Number((j.format && j.format.duration) || 0),
    channels: Number(s.channels || 0),
    codec: s.codec_name || '?',
    sampleRate: Number(s.sample_rate || 0),
  };
}

/** Integrated LUFS (input_i) + True-Peak (input_tp) a loudnorm méréséből.
 * FONTOS: a loudnorm a JSON-t SIKERES futáskor a stderr-re írja → spawnSync kell
 * (az execFileSync a stderr-t csak hibánál adja vissza). */
function loudness(file) {
  const r = spawnSync('ffmpeg', ['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  const stderr = r.stderr || '';
  const m = stderr.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!m) {
    return { lufs: NaN, tp: NaN };
  }
  const j = JSON.parse(m[0]);
  return { lufs: Number(j.input_i), tp: Number(j.input_tp) };
}

/** per-csatorna RMS (dB) a pan-ellenőrzéshez: [bal, jobb]. FONTOS: az astats minden
 * "Channel: N" blokkhoz ad RMS-t, ÉS a végén egy összegzőt — csak a PER-CSATORNA
 * értékek kellenek (a -inf = néma csatornát is kezeljük). */
function channelRms(file) {
  const r = spawnSync('ffmpeg', ['-i', file, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  const stderr = r.stderr || '';
  const rms = [];
  const blocks = stderr.split(/Channel:\s*\d+/).slice(1); // [ch1-blokk, ch2-blokk, …]
  for (const block of blocks) {
    const m = block.match(/RMS level dB:\s*(-?inf|-?[\d.]+)/);
    if (m) {
      rms.push(/inf/.test(m[1]) ? -Infinity : Number(m[1]));
    }
  }
  return rms;
}

/** dB formázás (−∞ a némának) */
function db(v) {
  return v === -Infinity ? '−∞' : v.toFixed(1);
}

// ── render ───────────────────────────────────────────────────────────────────

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
    form.append(field, new Blob([fs.readFileSync(file)]), path.basename(file));
  });
  form.append('uriMap', JSON.stringify(uriMap));
  // ⚠️ SZÁNDÉKOSAN nincs userId → owner-less job (token nélkül is pollolható, BOLA-OK)
  form.append('tier', 'pro');
  const settings = { resolution: 480, fps: 30, quality: 'high', audioFormat: FMT };
  if (SR) {
    settings.sampleRate = SR;
  }
  if (CH) {
    settings.channels = CH;
  }
  form.append('settings', JSON.stringify(settings));

  const submit = await fetch(`${BASE}/render`, { method: 'POST', body: form });
  const body = await submit.json().catch(() => ({}));
  if (!submit.ok || !body.id) {
    throw new Error(`submit ${submit.status}: ${body.error || 'ismeretlen hiba'}`);
  }
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const s = await fetch(`${BASE}/render/${body.id}`).then((r) => r.json()).catch(() => ({}));
    if (s.state === 'done') {
      const fileRes = await fetch(`${BASE}/render/${body.id}/file`);
      if (!fileRes.ok) {
        throw new Error(`file ${fileRes.status}`);
      }
      const out = path.join(OUT_DIR, `${name}.${EXT}`);
      fs.writeFileSync(out, Buffer.from(await fileRes.arrayBuffer()));
      return out;
    }
    if (s.state === 'error') {
      throw new Error(s.error || 'render error');
    }
  }
  throw new Error('timeout (fut a worker/API?)');
}

function evalExpect(expect, meas, baseline) {
  if (!expect) {
    return { ok: true, note: '' };
  }
  if (expect.durationSec != null && Math.abs(meas.durationSec - expect.durationSec) > 0.3) {
    return { ok: false, note: `hossz ${meas.durationSec.toFixed(2)}≠${expect.durationSec}` };
  }
  if (expect.channels != null && meas.channels !== expect.channels) {
    return { ok: false, note: `csatorna ${meas.channels}≠${expect.channels}` };
  }
  if (expect.quieterThan && baseline && Number.isFinite(meas.lufs) && Number.isFinite(baseline.lufs)) {
    return meas.lufs < baseline.lufs - 1
      ? { ok: true, note: `${(meas.lufs - baseline.lufs).toFixed(1)} LU a baseline alatt` }
      : { ok: false, note: `nem halkabb (${meas.lufs.toFixed(1)} vs ${baseline.lufs.toFixed(1)})` };
  }
  if (expect.panSide && meas.rms.length >= 2) {
    const [l, r] = meas.rms;
    if (expect.panSide === 'left') {
      return l > r + 3 ? { ok: true, note: `bal ${db(l)} > jobb ${db(r)}` } : { ok: false, note: `nem bal (${db(l)}/${db(r)})` };
    }
    return r > l + 3 ? { ok: true, note: `jobb ${db(r)} > bal ${db(l)}` } : { ok: false, note: `nem jobb (${db(l)}/${db(r)})` };
  }
  if (expect.lufsTarget != null && Number.isFinite(meas.lufs)) {
    return Math.abs(meas.lufs - expect.lufsTarget) <= 1.5
      ? { ok: true, note: `LUFS ${meas.lufs.toFixed(1)} ≈ cél ${expect.lufsTarget}` }
      : { ok: false, note: `LUFS ${meas.lufs.toFixed(1)} ≠ cél ${expect.lufsTarget} (±1.5)` };
  }
  return { ok: true, note: '' };
}

async function main() {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      console.error(`✗ ${bin} nincs a PATH-ban — telepítsd (brew install ffmpeg).`);
      process.exit(1);
    }
  }
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    log(`API: ${BASE} · render=${h.render} · format=${EXT}${SR ? ` · ${SR / 1000}k` : ''}${CH ? ` · ${CH}ch` : ''} · workers=${h.workers ?? 'n/a'}`);
  } catch {
    console.error(`✗ a render-API nem elérhető: ${BASE} — indítsd: cd server && ALLOW_INSECURE_DEV=1 npm start`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asmoke-media-'));
  const mediaFiles = generateMedia(mediaDir);

  const fixtures = buildSmokeProjects();
  const manifest = [];
  let baseline = null;
  let ok = 0;
  log('fixture               | LUFS   | TP    | ch | hossz | codec/sr | ellenőrzés');
  for (const { name, description, project, expect } of fixtures) {
    try {
      const out = await renderOne(name, project, mediaFiles);
      const p = probe(out);
      const { lufs, tp } = loudness(out);
      const rms = channelRms(out);
      const meas = { ...p, lufs, tp, rms };
      if (name === 'baseline') {
        baseline = meas;
      }
      const verdict = evalExpect(expect, meas, baseline);
      const mark = verdict.ok ? '✓' : '✗';
      log(
        `${name.padEnd(21)} | ${String(lufs.toFixed(1)).padStart(6)} | ${String(tp.toFixed(1)).padStart(5)} | ${String(p.channels).padStart(2)} | ${p.durationSec.toFixed(2).padStart(5)} | ${p.codec}/${Math.round(p.sampleRate / 1000)}k | ${mark} ${verdict.note}`
      );
      manifest.push({ name, description, ...meas, expect, verdict });
      if (verdict.ok) {
        ok++;
      }
    } catch (e) {
      log(`${name.padEnd(21)} | — rendelési hiba: ${e.message}`);
      manifest.push({ name, description, ok: false, error: e.message });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results: manifest }, null, 2));
  try {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  log(`kész: ${ok}/${fixtures.length} ellenőrzés OK → ${OUT_DIR}`);
  log('Hallgasd végig a WAV-okat, és vesd össze a szerkesztő-előnézettel (Preview == Export).');
  if (ok < fixtures.length) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[asmoke] végzetes hiba:', e.message);
  process.exit(1);
});
