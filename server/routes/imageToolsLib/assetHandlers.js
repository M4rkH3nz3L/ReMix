const { logCaught } = require('../../lib/caught');
// 🖼️ Kép-eszközök — AI-kivágás (bgremove), 3D matricák és mélység (2.5D parallax / fókusz) handlerei + a kész fájlok.
// A handlerek SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/imageTools.js-ben.
const fs = require('fs');
const path = require('path');

const { computeFocusAssets, computeParallaxAssets, depthLayerDir } = require('../../depth');
const { bgRemoveDir, computeCutout } = require('../../bgremove');
const { listStickers3d, renderSticker3d } = require('../../sticker3d');

// 🪄 AI background removal (P1 v1, fotón): u2net CPU-n → téma-kivágás
// átlátszó háttérrel (md5-cache) — a kliens overlay-képként használja.
exports.bgRemoveHandler = (req, res) => {
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
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('bgremove hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🔐 I47: a kivágás/mélység-rétegek csak bejelentkezve tölthetők le (nem nyilvános „capability URL")
exports.bgRemoveFileHandler = (req, res) => {
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
};

// 🧊 3D stickers (3D V1): CC0 glTF modellek three.js-szel PNG-vé renderelve
// (Chromium WebGL, fájl-cache) — a kliens overlay-képként használja őket.
exports.stickers3dListHandler = (_req, res) => {
  res.json({
    entries: listStickers3d().map((s) => ({
      id: s.id,
      label: s.label,
      url: `/stickers3d/${s.id}.png`,
    })),
  });
};

exports.sticker3dPngHandler = (req, res) => {
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
    logCaught('routes/imageTools.js', err);
      console.error('sticker3d hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🏔️ 2.5D Photo-to-3D (🧊 3D V1): fotó → mélységbecslés (Depth-Anything V2,
// lokálisan CPU-n) → fg/mid/bg parallax-rétegek. Md5 szerint cache-elt — a
// rétegeket a render közvetlenül az assets/depth mappából olvassa, az app az
// előnézethez a GET útvonalon éri el.
exports.depthParallaxHandler = (req, res) => {
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
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('depth hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

// 🌫️/🎬 depth-extrák: portré-blur + rack-focus változatok (közös mélység-cache)
exports.depthFocusHandler = (req, res) => {
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
    logCaught('routes/imageTools.js', err);
      cleanup();
      console.error('depth-focus hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
};

exports.depthFileHandler = (req, res) => {
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
};
