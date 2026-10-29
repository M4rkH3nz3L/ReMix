// 🖼️🤖 Kép-AI route-ok (arc-detektálás / shot-score / ég-csere / upscale).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből.

const fs = require('fs');
const path = require('path');
const express = require('express');

const { requireAuth } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { mediaGuard } = require('../security/uploadPolicy');
const { upload } = require('../lib/upload');
const { detectFaces } = require('../face');
const { scoreShots } = require('../thumbs');
const { listSkies, replaceSky } = require('../sky');
const { upscaleImage } = require('../upscale');

const router = express.Router();

// 🙂 Arc-detektálás egy képkockán (UltraFace, CPU) — a dobozok a megadott
// vászon-arányra normalizálva jönnek (a tracker/pozicionálás nyelvén).
router.post('/faces', ...proOnly, upload.any(), mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  detectFaces(file.path, {
    atSec: num(req.body.atSec, 0),
    aspectW: num(req.body.aspectW, 9),
    aspectH: num(req.body.aspectH, 16),
  })
    .then((result) => {
      cleanup();
      res.json(result);
    })
    .catch((err) => {
      cleanup();
      console.error('faces hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🏆 Best-shot pontozás (P0-1): forrás-időpontok vizuális minősége az Auto Edithez
router.post('/shotscore', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('video'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  let times;
  try {
    times = JSON.parse(req.body.times ?? '[]');
  } catch {
    times = [];
  }
  if (!Array.isArray(times) || times.length === 0) {
    cleanup();
    res.status(400).json({ error: 'Hiányzó időpontok.' });
    return;
  }
  scoreShots(file.path, times.map(Number).filter((t) => Number.isFinite(t) && t >= 0))
    .then((shots) => {
      cleanup();
      res.json({ shots });
    })
    .catch((err) => {
      cleanup();
      console.error('shotscore hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🌅 Sky Replacement (CC V2): égbolt-csere presetekkel (mélység-alapú maszk)
router.get('/sky/presets', (_req, res) => {
  res.json({ presets: listSkies() });
});

router.post('/sky', ...proOnly, upload.any(), mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  const preset = String(req.body.preset ?? 'sunset');
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  ensureDepth(file.path)
    .then(({ dir, depthPng, w, h }) =>
      replaceSky(file.path, depthPng, preset, dir, { w, h })
    )
    .then(({ file: out, cached }) => {
      const pngBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ cached, pngBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('sky hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🔍 Upscale / Enhance (CC V2): fotó felnagyítása szuper-felbontással
router.post('/upscale', ...proOnly, upload.any(), mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const scale = parseInt(req.body.scale, 10) === 4 ? 4 : 2;
  upscaleImage(file.path, { scale, workDir: req.workDir })
    .then(({ file: out, width, height, cached }) => {
      const pngBase64 = fs.readFileSync(out).toString('base64');
      cleanup();
      res.json({ width, height, cached, pngBase64 });
    })
    .catch((err) => {
      cleanup();
      console.error('upscale hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

module.exports = router;
