// 🖼️ Kép-eszköz route-ok (imagedoc/svg-pdf/color/text/bgremove/stickers3d/depth).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből —
// kép-rasterizálás/elemzés/ONNX; a viselkedés (watermark/tier/404-precedencia) változatlan.

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { requireAuth, INSECURE_DEV } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { mediaGuard } = require('../security/uploadPolicy');
const { upload } = require('../lib/upload');
const { shouldWatermark } = require('../entitlements');
const { asTier } = require('../tiers');
const { activeTier } = require('../billing');
const { renderImageDoc, imageDocGuard } = require('../imagedoc');
const { renderSvgToPdf } = require('../svgPdf');
const { computeFocusAssets, computeParallaxAssets, depthLayerDir } = require('../depth');
const { bgRemoveDir, computeCutout } = require('../bgremove');
const { colorStats, pixelColor, exportLut, scopeImage } = require('../color');
const { listStickers3d, renderSticker3d } = require('../sticker3d');

const router = express.Router();

/**
 * 🎨 Kép-dokumentum rasterizálása: réteg-fa (JSON) + a hivatkozott médiafájlok
 * → PNG. A formákat/feliratokat ugyanaz a generátor rajzolja, mint az
 * idővonalon, így a kép és a videó megjelenése garantáltan egyezik.
 */
router.post('/imagedoc', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  let doc;
  let uriMap;
  try {
    doc = JSON.parse(req.body.doc);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch {
    res.status(400).json({ error: 'Hibás doc/uriMap JSON.' });
    return;
  }
  // 🛡️ nagy-doc gát: inkább beszédes hiba, mint néma elakadás a workeren
  const guardError = imageDocGuard(doc);
  if (guardError) {
    res.status(413).json({ error: guardError });
    return;
  }
  // a rétegek uri-jait a feltöltött fájlokra írjuk át (ugyanaz a minta, mint a
  // /render-nél); a nem feltöltött hivatkozás marad, a rasterizáló kihagyja
  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  for (const layer of doc.layers ?? []) {
    for (const key of ['uri', 'imageUri', 'lut']) {
      const field = layer[key] ? uriMap[layer[key]] : null;
      const file = field ? fieldToFile.get(field) : null;
      if (file) {
        layer[key] = file;
      }
    }
  }
  const height = Math.max(240, Math.min(2160, Number(req.body.height) || 1280));
  const format = req.body.format; // png (alap) | jpg | webp
  const quality = req.body.quality != null ? Number(req.body.quality) : undefined;
  // ha a doc-hoz nem jött feltöltött média (tisztán vektor/forma/szöveg kép —
  // logó, gradient-poszter, felirat), a multer `destination`-je nem futott → nincs
  // req.workDir; itt pótoljuk, hogy a fotó NÉLKÜLI doc is renderelhető legyen.
  if (!req.workDir) {
    req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  }
  // a válasz (kép) teljes elküldése UTÁN takarítjuk a temp-mappát (eddig szivárgott)
  res.on('finish', () => fs.rm(req.workDir, { recursive: true, force: true }, () => {}));
  // 🏷️ free-vízjel a SZERVER-HITELES tier szerint (a kliens NEM kapcsolhatja ki):
  // prod-ban a user előfizetéséből (activeTier), dev-ben a kért tier-ből.
  const tierPromise = INSECURE_DEV ? Promise.resolve(asTier(req.body.tier)) : activeTier(req.user?.id);
  tierPromise
    .then((tier) => renderImageDoc(doc, height, req.workDir, { format, quality, watermark: shouldWatermark(tier) }))
    .then((file) => res.sendFile(file))
    .catch((err) => {
      console.warn('imagedoc hiba:', err.message.slice(0, 300));
      res.status(500).json({ error: err.message.slice(0, 300) });
    });
});

// 📄 SVG → nyomdakész vektor-PDF (a kliens imageDocToSvg kimenete → Chromium page.pdf).
// Az SVG-t FÁJLKÉNT töltjük fel (a beágyazott fotóktól nagy lehet — a mező-méret-limit
// nem gond), a vászon-méret (width/height px) mezőben jön.
router.post('/svg/pdf', upload.any(), requireAuth, rateLimit('analysis'), (req, res) => {
  const svgFile = (req.files ?? []).find((f) => f.fieldname === 'svg');
  let svg = '';
  try {
    svg = svgFile ? fs.readFileSync(svgFile.path, 'utf8') : String(req.body.svg || '');
  } catch {
    svg = String(req.body.svg || '');
  }
  if (!svg || !svg.includes('<svg')) {
    res.status(400).json({ error: 'Hiányzó vagy hibás SVG.' });
    return;
  }
  const width = Math.max(1, Math.min(10000, Number(req.body.width) || 1080));
  const height = Math.max(1, Math.min(10000, Number(req.body.height) || 1080));
  if (!req.workDir) {
    req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  }
  res.on('finish', () => fs.rm(req.workDir, { recursive: true, force: true }, () => {}));
  renderSvgToPdf(svg, { width, height, workDir: req.workDir })
    .then((file) => res.sendFile(file))
    .catch((err) => {
      console.warn('svg/pdf hiba:', err.message.slice(0, 300));
      res.status(500).json({ error: err.message.slice(0, 300) });
    });
});

router.post('/color/stats', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('image'), (req, res) => {
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
      cleanup();
      console.error('color-stats hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎨 Színpipetta: pixel-szín a médiakockán a (x,y) vászon-normalizált ponton
router.post('/color/pixel', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('image'), (req, res) => {
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
      cleanup();
      console.error('color-pixel hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎞️ LUT-export: a kliens elküldi a klip grade-jét (grade preset + adjust +
// curves + HSL), a worker egy identitás-rácsot átfuttat a szín-láncon és .cube
// 3D LUT-ot ad vissza. (Importált LUT-ot itt nem sütünk be — az a kliensen már
// megvan; a vignettát kihagyjuk, mert pozíciófüggő.)
router.post('/color/lut-export', express.json({ limit: '256kb' }), requireAuth, rateLimit('analysis'), (req, res) => {
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
      console.error('lut-export hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🩻 Videoszkóp: egy médiakocka waveform/parade/vectorscope/histogram képe PNG-ben
router.post('/color/scope', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('image'), (req, res) => {
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
      cleanup();
      console.error('color-scope hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🔁 Text → Shape: egy szövegklip a teljes stílusával átlátszó PNG-vé sütve,
// hogy forma-klip kép-kitöltéseként tovább animálható legyen (kép + w/h).
router.post('/text/bake', express.json({ limit: '256kb' }), requireAuth, rateLimit('analysis'), (req, res) => {
  const clip = req.body.clip;
  const canvas = req.body.canvas;
  if (!clip || typeof clip.text !== 'string' || !canvas || !canvas.w || !canvas.h) {
    res.status(400).json({ error: 'Hiányzó szövegklip / vászon.' });
    return;
  }
  const { bakeTextPng } = require('../text-render');
  bakeTextPng(clip, { w: Math.round(canvas.w), h: Math.round(canvas.h) })
    .then((r) => res.json(r))
    .catch((err) => {
      console.error('text-bake hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🪄 AI background removal (P1 v1, fotón): u2net CPU-n → téma-kivágás
// átlátszó háttérrel (md5-cache) — a kliens overlay-képként használja.
router.post('/bgremove', upload.any(), ...proOnly, mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeCutout(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        cutout: `/bgremove/${id}/cutout.png`,
        alpha: `/bgremove/${id}/alpha.png`,
      });
    })
    .catch((err) => {
      cleanup();
      console.error('bgremove hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

router.get('/bgremove/:id/:name', (req, res) => {
  const { id, name } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id) || !/^(cutout|alpha)\.png$/.test(name)) {
    res.status(400).json({ error: 'Hibás kérés.' });
    return;
  }
  const file = path.join(bgRemoveDir(id), name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'Nincs ilyen kivágás.' });
    return;
  }
  res.sendFile(file);
});

// 🧊 3D stickers (3D V1): CC0 glTF modellek three.js-szel PNG-vé renderelve
// (Chromium WebGL, fájl-cache) — a kliens overlay-képként használja őket.
router.get('/stickers3d', (_req, res) => {
  res.json({
    entries: listStickers3d().map((s) => ({
      id: s.id,
      label: s.label,
      url: `/stickers3d/${s.id}.png`,
    })),
  });
});

router.get('/stickers3d/:id.png', (req, res) => {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  renderSticker3d(req.params.id, {
    yaw: num(req.query.yaw),
    pitch: num(req.query.pitch),
    size: num(req.query.size),
    material: req.query.material,
    environment: req.query.env,
    shadow: req.query.shadow,
  })
    .then((file) => res.sendFile(file))
    .catch((err) => {
      console.error('sticker3d hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🏔️ 2.5D Photo-to-3D (🧊 3D V1): fotó → mélységbecslés (Depth-Anything V2,
// lokálisan CPU-n) → fg/mid/bg parallax-rétegek. Md5 szerint cache-elt — a
// rétegeket a render közvetlenül az assets/depth mappából olvassa, az app az
// előnézethez a GET útvonalon éri el.
router.post('/depth/parallax', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeParallaxAssets(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        layers: {
          bg: `/depth/${id}/bg.png`,
          mid: `/depth/${id}/mid.png`,
          fg: `/depth/${id}/fg.png`,
        },
      });
    })
    .catch((err) => {
      cleanup();
      console.error('depth hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🌫️/🎬 depth-extrák: portré-blur + rack-focus változatok (közös mélység-cache)
router.post('/depth/focus', upload.any(), requireAuth, rateLimit('analysis'), mediaGuard('image'), (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó képfájl.' });
    return;
  }
  const cleanup = () => {
    fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  };
  computeFocusAssets(file.path)
    .then(({ id, cached }) => {
      cleanup();
      res.json({
        id,
        cached,
        variants: {
          near: `/depth/${id}/focus-near.png`,
          far: `/depth/${id}/focus-far.png`,
        },
      });
    })
    .catch((err) => {
      cleanup();
      console.error('depth-focus hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

router.get('/depth/:id/:name', (req, res) => {
  const { id, name } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id) || !/^(bg|mid|fg|depth|focus-near|focus-far)\.png$/.test(name)) {
    res.status(400).json({ error: 'Hibás kérés.' });
    return;
  }
  const file = path.join(depthLayerDir(id), name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'Nincs ilyen réteg.' });
    return;
  }
  res.sendFile(file);
});

module.exports = router;
