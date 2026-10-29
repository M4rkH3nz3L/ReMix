// 🎬🎧 Média route-ok (thumbnail-compose / voice-preview / captions / waveform /
// media-upload / audio-analyze / audio-stems).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből.

const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { mediaGuard } = require('../security/uploadPolicy');
const { upload } = require('../lib/upload');
const { composeThumbnail } = require('../thumbs');
const { voiceChain } = require('../voicechain');
const { mediaStoreEnabled, uploadMedia: mediaStoreUpload, BUCKET: MEDIA_BUCKET } = require('../mediastore');
const { QuotaExceededError, quotaAvailable, recordObject, wouldExceed } = require('../quota');
const { stemsConfigured, separateStems } = require('../stems');
const userStorage = require('../userStorage');

const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(__dirname, '..', 'models', 'ggml-base.bin');

const router = express.Router();

// --- thumbnail-compose + voice-preview ---
// 🎬 headline ráégetése a kiválasztott borítóra (Chromium-raszter + overlay)
router.post('/thumbnails/compose', requireAuth, rateLimit('analysis'), upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  const headline = String(req.body.headline ?? '').trim();
  if (!file || !headline) {
    res.status(400).json({ error: 'Hiányzó kép vagy headline.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  composeThumbnail(file.path, headline, workDir)
    .then((out) => {
      const jpegBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ jpegBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('thumb-compose hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});



// 🎨 Color AI (P1 v1): egy kocka szín-statisztikái — Auto/Match Color alapja
/**
 * 🎙️ Voice Studio ELŐNÉZETI PROXY: a feltöltött hang/videó hangsávjára
 * ráfuttatja a RENDERREL AZONOS beszéd-javító láncot (voicechain.js), és
 * m4a-ként adja vissza. Így a szerkesztőben már hallható a javítás, nem csak
 * a kész exportban.
 *
 * A teljes hangot dolgozzuk fel (nem szeletet): így az előnézet bárhová
 * tekerhető, és a kliens fájlonként+beállításonként cache-eli.
 */
router.post('/voice/preview', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('audio'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const chain = voiceChain({
    voiceEnhance: req.body.voiceEnhance === 'true' || req.body.voiceEnhance === '1',
    deReverb: req.body.deReverb === 'true' || req.body.deReverb === '1',
  });
  if (!chain) {
    res.status(400).json({ error: 'Nincs bekapcsolt hang-javítás.' });
    return;
  }
  const out = path.join(req.workDir, 'voice.m4a');
  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-af', chain, '-c:a', 'aac', '-b:a', '160k', out],
    { timeout: 5 * 60 * 1000, maxBuffer: 1 << 24 },
    (err) => {
      if (err || !fs.existsSync(out)) {
        console.warn('voice-proxy hiba:', (err && err.message || '').slice(0, 200));
        res.status(422).json({ error: 'A hang feldolgozása nem sikerült.' });
        return;
      }
      res.sendFile(out);
    }
  );
});

// --- captions / waveform / media-upload / audio-analyze / audio-stems ---
// Auto-caption: médiafájl → hang kinyerése → Whisper → SRT.
// A kliens a kapott SRT-t a meglévő import-útvonalon dolgozza fel.
router.post('/captions', ...proOnly, upload.any(), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    res.status(500).json({
      error: `Hiányzó Whisper-modell: ${WHISPER_MODEL} (töltsd le a huggingface ggerganov/whisper.cpp repóból).`,
    });
    return;
  }
  const workDir = req.workDir;
  const wav = path.join(workDir, 'audio16k.wav');
  const outBase = path.join(workDir, 'captions');
  const language = req.body.language || 'auto';
  // granularity=word: szavankénti cue-k (text-based editing, P0-3);
  // alapértelmezés: caption-méretű darabok (max ~40 karakter, szóhatáron)
  const maxLen = req.body.granularity === 'word' ? '1' : '40';

  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-ar', '16000', '-ac', '1', wav],
    { timeout: 5 * 60 * 1000 },
    (ffErr) => {
      if (ffErr) {
        res.status(422).json({ error: 'Nincs kinyerhető hang a fájlból.' });
        return;
      }
      execFile(
        'whisper-cli',
        [
          '-m', WHISPER_MODEL,
          '-f', wav,
          '-l', language,
          '-ml', maxLen,
          '-sow',
          '--output-srt',
          '--output-file', outBase,
          '--no-prints',
        ],
        { timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (wErr) => {
          if (wErr) {
            console.error('whisper hiba:', wErr.message);
            res.status(500).json({ error: 'A beszédfelismerés nem sikerült.' });
            return;
          }
          try {
            const srt = fs.readFileSync(`${outBase}.srt`, 'utf8');
            res.json({ srt });
          } catch {
            res.status(500).json({ error: 'A felirat-fájl nem jött létre.' });
          }
        }
      );
    }
  );
});

// Hullámforma az idővonalhoz: hangfájl → mono 8 kHz PCM → csúcslista.
// A kliens lemezre cache-eli, egy fájl csak egyszer jön fel.
router.post('/waveform', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('audio'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const RATE = 8000;
  const PEAKS_PER_SEC = 20;
  const MAX_SECONDS = 30 * 60;
  const pcm = path.join(workDir, 'wave.pcm');
  execFile(
    'ffmpeg',
    ['-y', '-i', file.path, '-vn', '-ac', '1', '-ar', String(RATE),
     '-t', String(MAX_SECONDS), '-f', 's16le', pcm],
    { timeout: 5 * 60 * 1000 },
    (err) => {
      if (err) {
        cleanup();
        res.status(422).json({ error: 'Nincs kinyerhető hang a fájlból.' });
        return;
      }
      try {
        const buf = fs.readFileSync(pcm);
        const samples = Math.floor(buf.length / 2);
        const bucket = Math.max(1, Math.floor(RATE / PEAKS_PER_SEC));
        const peaks = [];
        let top = 0.01;
        for (let i = 0; i < samples; i += bucket) {
          let max = 0;
          const end = Math.min(samples, i + bucket);
          for (let j = i; j < end; j++) {
            const v = Math.abs(buf.readInt16LE(j * 2));
            if (v > max) {
              max = v;
            }
          }
          const p = max / 32768;
          peaks.push(p);
          if (p > top) {
            top = p;
          }
        }
        cleanup();
        res.json({
          duration: samples / RATE,
          peaksPerSecond: PEAKS_PER_SEC,
          // a leghangosabb ponthoz normalizálva, 2 tizedesre kerekítve
          peaks: peaks.map((p) => Math.round((p / top) * 100) / 100),
        });
      } catch {
        cleanup();
        res.status(500).json({ error: 'A hullámforma-számítás nem sikerült.' });
      }
    }
  );
});

// 🎞️ Média-feltöltés (renderelt videó / borító) → publikus Storage-URL. A kliens
// a renderelt fájlt küldi (multipart), a feed ezt a URL-t játssza (cross-device).
router.post('/media/upload', requireAuth, upload.any(), async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  // 👤 a hívó a VERIFIKÁLT tokenből (dev-ben body.userId fallback) — ő terhelődik
  const uid = callerId(req, req.body?.userId);
  const bytes = Number(f.size || 0);
  const extRaw = path.extname(f.originalname || '') || `.${(f.mimetype || '').split('/')[1] || 'bin'}`;
  const ext = extRaw.replace(/[^.\w]/g, '');
  // a KÉRÉSBŐL épített worker-origin (LAN-on is stimmel; a lokális-disk URL-hez is)
  const publicBase = `${req.protocol}://${req.get('host')}`;
  try {
    // 🎯 AKTÍV TÁRHELY-CÉL: ha a user KÜLSŐ forrást jelölt ki, ODA mentünk (a saját
    // felhőjébe) — nem a MI (kvótás) tárhelyünkre, és a MI tárhely-konfig sem kell.
    // A visszaadott URL a proxyzott, VISSZAOLVASHATÓ út (a capability-token viszi a
    // jogosultságot bearer nélkül — a lejátszó/letöltő ezt hívja később is).
    let target = null;
    if (uid) {
      try {
        target = await userStorage.getDefaultTarget(uid);
      } catch {
        target = null;
      }
    }
    if (target) {
      const filename = `${crypto.randomUUID()}${ext}`;
      const { path: extPath, token } = await userStorage.uploadToSource(
        uid,
        target,
        f.path,
        filename,
        f.mimetype
      );
      const url = `${publicBase}/storage/${encodeURIComponent(target)}/file?path=${encodeURIComponent(
        extPath
      )}&it=${encodeURIComponent(token)}`;
      res.json({ url, key: extPath, size: bytes, target });
      return;
    }

    // ── ReMix-tárhely (alap): a MI tárolónkba + KVÓTA ──
    if (!mediaStoreEnabled()) {
      res.status(503).json({ error: 'storage nincs konfigurálva (SUPABASE service_role vagy S3_* env)' });
      return;
    }
    if (uid && quotaAvailable()) {
      const { exceeded, usage } = await wouldExceed(uid, bytes);
      if (exceeded) {
        res.status(507).json({ error: 'quota_exceeded', usage });
        return;
      }
    }
    // 📁 PROJEKT-rendezett kulcs: <projectId>/<kind>/<uuid>.<ext> (projekt nélkül <kind>/…)
    const kind = String(req.body?.kind || 'media').replace(/[^a-z]/gi, '').slice(0, 20) || 'media';
    const projectId = String(req.body?.projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
    const file = `${crypto.randomUUID()}${ext}`;
    const key = projectId ? `${projectId}/${kind}/${file}` : `${kind}/${file}`;
    const url = await mediaStoreUpload(key, f.path, f.mimetype, publicBase);
    // 🗄️ felvétel a bájt-naplóba (atomikus kvóta-ellenőrzéssel — verseny-biztos)
    if (uid && quotaAvailable()) {
      await recordObject(uid, {
        projectId: projectId || null,
        bucket: MEDIA_BUCKET,
        key,
        bytes,
        source: 'server',
      });
    }
    res.json({ url, key, size: bytes });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(507).json({ error: 'quota_exceeded', usage: err.usage });
      return;
    }
    console.error('Media upload hiba:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
  }
});

// 🎚️ Hang-analízis (AUDIO-MASTER Analyze): egy feltöltött hangon az ffmpeg
// `loudnorm` MÉRŐ-menete (print_format=json) → Integrated LUFS / True Peak / LRA,
// + egy `showspectrumpic` spektrum-kép (best-effort, a média-tárba).
router.post('/audio/analyze', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('audio'), async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  const measure = () =>
    new Promise((resolve) => {
      execFile(
        'ffmpeg',
        ['-hide_banner', '-nostats', '-i', f.path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
        { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
        (_e, _o, stderr) => resolve(/\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(stderr || '')?.[0] ?? null)
      );
    });
  try {
    const raw = await measure();
    if (!raw) {
      res.status(500).json({ error: 'Az analízis nem sikerült.' });
      return;
    }
    const j = JSON.parse(raw);
    const out = { lufs: Number(j.input_i), truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
    // 📊 zaj-alap + dinamika-tartomány (astats) — best-effort
    try {
      const st2 = await new Promise((resolve) =>
        execFile(
          'ffmpeg',
          ['-hide_banner', '-nostats', '-i', f.path, '-af', 'astats=metadata=1', '-f', 'null', '-'],
          { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
          (_e, _o, se) => resolve(se || '')
        )
      );
      const nf = /Noise floor dB:\s*(-?[\d.]+)/.exec(st2);
      const dr = /Dynamic range:\s*([\d.]+)/.exec(st2);
      if (nf) {
        out.noise = Number(nf[1]);
      }
      if (dr) {
        out.dynamicRange = Number(dr[1]);
      }
    } catch {
      // az astats opcionális
    }
    // 🎨 spektrum-kép (opcionális): showspectrumpic → média-tár
    if (mediaStoreEnabled()) {
      try {
        const specPath = `${f.path}.png`;
        await new Promise((resolve, reject) =>
          execFile(
            'ffmpeg',
            ['-y', '-i', f.path, '-lavfi', 'showspectrumpic=s=600x220:legend=0', specPath],
            { timeout: 60000 },
            (e) => (e ? reject(e) : resolve())
          )
        );
        const publicBase = `${req.protocol}://${req.get('host')}`;
        out.spectrum = await mediaStoreUpload(`analyze/${crypto.randomUUID()}.png`, specPath, 'image/png', publicBase);
        try {
          fs.unlinkSync(specPath);
        } catch {
          // takarítás best-effort
        }
      } catch {
        // a spektrum opcionális — a mérés attól még megy
      }
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
  }
});

// 🎚️ Stem-szeparáció (AI audio, Phase D) — Pro + Demucs (env-kapuzva). A feltöltött
// hangot vocals/drums/bass/other WAV-okra bontja, feltölti a média-tárba, és
// visszaadja a stemek URL-jeit. A kliens ezekből ÚJ hangklipeket rak a sávokra.
router.post('/audio/stems', ...proOnly, upload.any(), async (req, res) => {
  if (!stemsConfigured()) {
    res.status(503).json({ error: 'A stem-szeparáció nincs konfigurálva (Demucs).' });
    return;
  }
  if (!mediaStoreEnabled()) {
    res.status(503).json({ error: 'storage nincs konfigurálva (SUPABASE service_role vagy S3_* env)' });
    return;
  }
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'nincs fájl' });
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-stems-'));
  const publicBase = `${req.protocol}://${req.get('host')}`;
  try {
    const stems = await separateStems(f.path, workDir);
    const out = [];
    for (const s of stems) {
      const key = `stems/${crypto.randomUUID()}-${s.name}.wav`;
      const url = await mediaStoreUpload(key, s.path, 'audio/wav', publicBase);
      out.push({ name: s.name, url });
    }
    res.json({ stems: out });
  } catch (err) {
    console.error('Stem-szeparáció hiba:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(f.path);
    } catch {
      // takarítás best-effort
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // takarítás best-effort
    }
  }
});

module.exports = router;
