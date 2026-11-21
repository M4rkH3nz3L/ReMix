const { logCaught } = require('../../lib/caught');
// 🖼️ Kép-eszközök — szín-elemzés (stats / pipetta / LUT-export / szkóp) és a szöveg → PNG sütés handlerei.
// A handlerek SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/imageTools.js-ben.
const fs = require('fs');

const { colorStats, pixelColor, exportLut, scopeImage } = require('../../color');

exports.colorStatsHandler = (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  colorStats(file.path, Number.isFinite(atSec) ? atSec : 0)
    .then((stats) => {
      cleanup();
      res.json(stats);
    })
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('color-stats hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🎨 Színpipetta: pixel-szín a médiakockán a (x,y) vászon-normalizált ponton
exports.colorPixelHandler = (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  const x = Number(req.body.x);
  const y = Number(req.body.y);
  pixelColor(file.path, Number.isFinite(atSec) ? atSec : 0, Number.isFinite(x) ? x : 0.5, Number.isFinite(y) ? y : 0.5)
    .then((r) => {
      cleanup();
      res.json(r);
    })
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('color-pixel hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🎞️ LUT-export: a kliens elküldi a klip grade-jét (grade preset + adjust +
// curves + HSL), a worker egy identitás-rácsot átfuttat a szín-láncon és .cube
// 3D LUT-ot ad vissza. (Importált LUT-ot itt nem sütünk be — az a kliensen már
// megvan; a vignettát kihagyjuk, mert pozíciófüggő.)
exports.lutExportHandler = (req, res) => {
  const clip = {
    grade: typeof req.body.grade === 'string' ? req.body.grade : undefined,
    strength: Number.isFinite(Number(req.body.strength)) ? Number(req.body.strength) : undefined,
    adjust: req.body.adjust && typeof req.body.adjust === 'object' ? req.body.adjust : {},
  };
  const size = Number(req.body.size);
  exportLut(clip, Number.isFinite(size) ? size : 33)
    .then((cube) => {
      res.type('text/plain').send(cube);
    })
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      console.error('lut-export hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🩻 Videoszkóp: egy médiakocka waveform/parade/vectorscope/histogram képe PNG-ben
exports.colorScopeHandler = (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  const atSec = Number(req.body.atSec);
  const type = typeof req.body.type === 'string' ? req.body.type : 'waveform';
  scopeImage(file.path, Number.isFinite(atSec) ? atSec : 0, type)
    .then((r) => {
      cleanup();
      res.json(r);
    })
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('color-scope hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🔁 Text → Shape: egy szövegklip a teljes stílusával átlátszó PNG-vé sütve,
// hogy forma-klip kép-kitöltéseként tovább animálható legyen (kép + w/h).
exports.textBakeHandler = (req, res) => {
  const clip = req.body.clip;
  const canvas = req.body.canvas;
  if (!clip || typeof clip.text !== 'string' || !canvas || !canvas.w || !canvas.h) {
    res.status(400).json({ error: 'Hiányzó szövegklip / vászon.' });
    return;
  }
  const { bakeTextPng } = require('../../text-render');
  bakeTextPng(clip, { w: Math.round(canvas.w), h: Math.round(canvas.h) })
    .then((r) => res.json(r))
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      console.error('text-bake hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};
