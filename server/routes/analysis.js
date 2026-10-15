// 🎛️ Editor-analízis route-ok (jelenet/beat/követés/vízió/thumbnail/reframe/csend).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből —
// forrás-idejű elemző végpontok (nincs jobs-map csatolás), a viselkedés változatlan.

const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');

const { requireAuth } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { mediaGuard } = require('../security/uploadPolicy');
const { upload } = require('../lib/upload');
const { analyzeBeats } = require('../beats');
const { trackMedia } = require('../track');
const { indexFrames, queryScores } = require('../vision');
const { pickThumbnails } = require('../thumbs');
const { analyzeReframe } = require('../reframe');

const router = express.Router();

// Jelenet-detektálás (Editor AI, szemantikus index): FFmpeg scene-score —
// a válasz a FORRÁS-időben értett jelenetváltás-időpontok listája + a fájl
// hossza. A küszöb (threshold, 0-1) a body-ban felülírható.
router.post('/scenes', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const raw = parseFloat(req.body.threshold);
  const threshold = Number.isFinite(raw) ? Math.min(0.9, Math.max(0.1, raw)) : 0.35;

  execFile(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, probeOut) => {
      const duration = probeErr ? 0 : parseFloat(probeOut) || 0;
      execFile(
        'ffmpeg',
        ['-i', file.path, '-an',
         // a metadata=print a naplóra (stderr) ír — a pipe:1 a null-muxer
         // stdout-jával ütközne
         '-vf', `select='gt(scene,${threshold})',metadata=print`,
         '-f', 'null', '-'],
        { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          cleanup();
          if (err) {
            res.json({ duration, scenes: [] });
            return;
          }
          const scenes = [];
          for (const line of (stderr ?? '').split('\n')) {
            if (!line.includes('Parsed_metadata')) {
              continue;
            }
            const m = line.match(/pts_time:([\d.]+)/);
            if (m) {
              const t = parseFloat(m[1]);
              // duplikált/0-közeli időpontok kihagyva
              if (t > 0.05 && (scenes.length === 0 || t - scenes[scenes.length - 1] > 0.05)) {
                scenes.push(t);
              }
            }
          }
          res.json({ duration, scenes });
        }
      );
    }
  );
});

// Beat-analízis (P0-2 Beat Sync): BPM + beat/downbeat-rács + energia-görbe a
// FORRÁS-időben. Függőség nélküli onset/autokorrelációs elemzés (beats.js).
router.post('/beats', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  analyzeBeats(file.path)
    .then((grid) => {
      cleanup();
      res.json(grid);
    })
    .catch((err) => {
      cleanup();
      // hang nélküli / dekódolhatatlan fájl — üres rács, a kliens jelzi
      console.warn('Beat-analízis hiba:', err.message);
      res.json({ bpm: 0, beats: [], downbeats: [], energy: [], duration: 0 });
    });
});

// Pont-követés (P0-6 tracking): a megadott vászon-pont követése a szakaszon —
// NCC template-tracker (track.js), a válasz vászon-normalizált pont-sor.
router.post('/track', upload.any(), ...proOnly, (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  trackMedia(file.path, {
    startSec: Math.max(0, num(req.body.startSec, 0)),
    durationSec: Math.min(20, Math.max(0.5, num(req.body.durationSec, 5))),
    cx: Math.min(1, Math.max(0, num(req.body.cx, 0.5))),
    cy: Math.min(1, Math.max(0, num(req.body.cy, 0.5))),
    aspectW: num(req.body.aspectW, 9),
    aspectH: num(req.body.aspectH, 16),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.warn('Követés hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Smart Search (P0-8): jelenet-keyframe-ek vision-címkézése — a kliens küldi
// a forrás-időpontokat, a válasz időpontonként magyar leírás + címkék
// (tartalom-hash lemez-cache-sel; a modell letöltése: ollama pull qwen2.5vl:7b).
router.post('/vision/index', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  let times;
  try {
    times = JSON.parse(req.body.times ?? '[]');
  } catch {
    times = [];
  }
  if (!Array.isArray(times) || times.length === 0) {
    cleanup();
    res.status(400).json({ error: 'Hiányzó időpont-lista.' });
    return;
  }
  indexFrames(file.path, times.slice(0, 20).map((t) => Math.max(0, Number(t) || 0)), workDir)
    .then((entries) => {
      cleanup();
      res.json({ entries });
    })
    .catch((err) => {
      cleanup();
      console.warn('Vision-index hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Smart Search lekérdezés: query + dokumentumok → hasonlóság-pontok
// (nomic-embed-text a lokális Ollamában).
router.post('/vision/query', express.json({ limit: '1mb' }), requireAuth, rateLimit('analysis'), (req, res) => {
  const { query, docs } = req.body ?? {};
  if (!query || !Array.isArray(docs) || docs.length === 0) {
    res.status(400).json({ error: 'Hiányzó lekérdezés vagy dokumentumok.' });
    return;
  }
  queryScores(String(query), docs.slice(0, 200).map((d) => String(d).slice(0, 500)))
    .then((scores) => res.json({ scores }))
    .catch((err) => {
      console.warn('Vision-query hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Thumbnail Studio (Creative Canvas): a legjobb borítókép-kockák kiválasztása
// (élesség+kontraszt pontozás) — a válasz base64 JPEG-ek listája.
router.post('/thumbnails', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('video'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const count = Math.min(6, Math.max(1, parseInt(req.body.count, 10) || 4));
  pickThumbnails(file.path, { count, workDir })
    .then((thumbs) => {
      const out = thumbs.map((t) => ({
        t: t.t,
        score: t.score,
        jpegBase64: fs.readFileSync(t.file).toString('base64'),
      }));
      cleanup();
      res.json({ thumbs: out });
    })
    .catch((err) => {
      cleanup();
      console.warn('Thumbnail hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Auto Reframe (P0-7): a téma középpont-útja a szakaszon (mozgás-centroid) —
// forrás-normalizált pontok + forrás-méret; a kliens fordít crop-kulcskockákra.
router.post('/reframe', upload.any(), ...proOnly, mediaGuard('video'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  analyzeReframe(file.path, {
    startSec: Math.max(0, num(req.body.startSec, 0)),
    durationSec: Math.min(60, Math.max(0.5, num(req.body.durationSec, 10))),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.warn('Reframe hiba:', err.message);
      res.status(422).json({ error: err.message });
    });
});

// Csend-detektálás (Editor AI cut-listák): FFmpeg silencedetect — a válasz a
// FORRÁS-időben értett csend-intervallumok listája + a fájl hossza. Hang
// nélküli fájlra üres lista jön (nem hiba).
router.post('/silence', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  const cleanup = () => {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  };
  const noise = /^-?\d+dB$/.test(req.body.noise ?? '') ? req.body.noise : '-35dB';
  const minSilence = Math.min(5, Math.max(0.2, parseFloat(req.body.minSilence) || 0.5));

  execFile(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, probeOut) => {
      const duration = probeErr ? 0 : parseFloat(probeOut) || 0;
      execFile(
        'ffmpeg',
        ['-i', file.path, '-vn',
         '-af', `silencedetect=noise=${noise}:d=${minSilence}`,
         '-f', 'null', '-'],
        { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          cleanup();
          if (err) {
            // nincs hang-stream — csend-információ nélkül megy tovább a kliens
            res.json({ duration, silences: [] });
            return;
          }
          const silences = [];
          let current = null;
          for (const line of (stderr ?? '').split('\n')) {
            const s = line.match(/silence_start:\s*(-?[\d.]+)/);
            const e = line.match(/silence_end:\s*([\d.]+)/);
            if (s) {
              current = Math.max(0, parseFloat(s[1]));
            }
            if (e && current !== null) {
              silences.push({ start: current, end: parseFloat(e[1]) });
              current = null;
            }
          }
          // a fájl végéig tartó csendet nem zárja silence_end sor
          if (current !== null && duration > current) {
            silences.push({ start: current, end: duration });
          }
          res.json({ duration, silences });
        }
      );
    }
  );
});

module.exports = router;
