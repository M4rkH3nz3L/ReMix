const { logCaught } = require('../../lib/caught');
// 📦 POST /proxy (720p munka-példány) és POST /collect (projekt + média zip) — a közös job-tárba dolgoznak.
// A kezelők SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/render.js-ben.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { jobs } = require('./jobStore');

// Vágási proxy (full-plan F2): a nagy felbontású videóból 720p-s, gyorsan
// dekódolható munka-példány készül — az app előnézete ezt játssza, a render
// az eredetivel fut. Ha a forrás eleve ≤1280 px, {skip:true} a válasz.
// Állapot/letöltés a közös job-végpontokon (/render/:id).
exports.proxyHandler = (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Hiányzó médiafájl.' });
    return;
  }
  const workDir = req.workDir;
  execFile(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
     '-of', 'csv=s=x:p=0', file.path],
    { timeout: 30 * 1000 },
    (probeErr, stdout) => {
      const dims = (stdout ?? '').trim().split('x').map((n) => parseInt(n, 10));
      if (probeErr || dims.length < 2 || !dims[0] || !dims[1]) {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        res.status(422).json({ error: 'Nincs videó-stream a fájlban.' });
        return;
      }
      // 🎚️ minőség-tier: a kliens a kért leghosszabb oldalt küldi (maxSide);
      // ha a forrás eleve ennél kisebb, nincs mit nyerni (skip)
      const maxSide = Math.min(
        2160,
        Math.max(320, Math.round(Number(req.body?.maxSide) || 1280))
      );
      if (Math.max(dims[0], dims[1]) <= maxSide) {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        res.json({ skip: true });
        return;
      }
      const id = crypto.randomBytes(8).toString('hex');
      // 🔒 B26: a proxy-job is a hívóé (eddig tulajdonos nélkül → ID birtokában bárki letölthette)
      const owner = req.user?.id || null;
      jobs.set(id, { state: 'processing', dir: workDir, userId: owner });
      res.json({ id });

      const out = path.join(workDir, 'proxy.mp4');
      execFile(
        'ffmpeg',
        ['-y', '-i', file.path,
         '-vf', `scale=w=${maxSide}:h=${maxSide}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out],
        { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
        (err) => {
          if (err) {
            console.error(`[${id}] proxy hiba:`, err.message);
            jobs.set(id, { state: 'error', error: 'A proxy-készítés nem sikerült.', dir: workDir, userId: owner });
          } else {
            jobs.set(id, { state: 'done', file: out, dir: workDir, userId: owner });
          }
        }
      );
    }
  );
};

// Collect Project: projekt + minden média egy zip-archívumban (átadás/archívum).
// A médiafájlok a media/ mappába kerülnek, a projekt uri-jai relatív útra
// íródnak át; állapot/letöltés a közös job-végpontokon (/render/:id).
exports.collectHandler = (req, res) => {
  let project;
  let uriMap;
  try {
    project = JSON.parse(req.body.project);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch (caught) {
    logCaught('routes/render.js', caught);
    res.status(400).json({ error: 'Hibás project/uriMap JSON.' });
    return;
  }
  const workDir = req.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  const mediaDir = path.join(workDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const fieldToFile = new Map((req.files ?? []).map((f) => [f.fieldname, f.path]));
  const relByUri = new Map();
  for (const [uri, field] of Object.entries(uriMap)) {
    const src = fieldToFile.get(field);
    if (!src) {
      continue;
    }
    const rel = path.join('media', path.basename(src));
    fs.renameSync(src, path.join(workDir, rel));
    relByUri.set(uri, rel);
  }
  for (const track of project.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.uri && relByUri.has(clip.uri)) {
        clip.uri = relByUri.get(clip.uri);
      }
    }
  }
  for (const asset of project.assets ?? []) {
    if (asset.uri && relByUri.has(asset.uri)) {
      asset.uri = relByUri.get(asset.uri);
    }
  }
  fs.writeFileSync(
    path.join(workDir, 'project.remix'),
    JSON.stringify(
      {
        format: 'vided-project',
        version: 1,
        exportedAt: new Date().toISOString(),
        collected: true,
        project,
      },
      null,
      2
    )
  );

  const id = crypto.randomBytes(8).toString('hex');
  // 🔒 B26: a collect-csomag (a teljes projekt médiástul) is a hívóé
  const owner = req.user?.id || null;
  jobs.set(id, { state: 'processing', dir: workDir, userId: owner });
  res.json({ id });

  const out = path.join(workDir, 'collect.zip');
  execFile(
    'zip',
    ['-r', '-q', out, 'project.remix', 'media'],
    { cwd: workDir, timeout: 10 * 60 * 1000 },
    (err) => {
      if (err) {
        console.error(`[${id}] collect hiba:`, err.message);
        jobs.set(id, { state: 'error', error: 'A csomagolás nem sikerült.', dir: workDir, userId: owner });
      } else {
        jobs.set(id, { state: 'done', file: out, dir: workDir, userId: owner });
      }
    }
  );
};
