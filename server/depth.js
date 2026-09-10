// 🏔️ 2.5D Photo-to-3D (🧊 3D V1): monokuláris mélységbecslés + parallax-rétegek.
//
// Mélység: Depth-Anything V2 small ONNX-ben, CPU-n (a fejlesztő gépen fut,
// GPU nélkül ~1-2 mp/kép) — a modellfájl a LOCAL_DEPTH_MODEL env-vel
// cserélhető. A kép dekódolása/skálázása ffmpeg-gel megy (nincs új képlib).
//
// Rétegek: a normalizált mélységből három RGBA PNG készül —
//   bg.png  — teljes kép, a közeli tartalom helye elmosással kitöltve (a
//             parallax-mozgásnál kilátszó „lyuk" így nem szellemképes),
//   mid.png — a középtávol lágy alfa-maszkkal (a fg úgyis fölé kerül),
//   fg.png  — a legközelebbi tartalom lágy alfa-maszkkal.
// A render a három réteget eltérő erejű kameramozgással kompozitálja.
//
// Cache: assets/depth/<md5(kép)>/ — worker-újraindítás után is él, és
// ugyanarra a fotóra nem számol újra.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL_PATH =
  process.env.LOCAL_DEPTH_MODEL ||
  path.join(__dirname, 'models', 'depth-anything-v2-small.onnx');
const DEPTH_DIR = path.join(__dirname, 'assets', 'depth');
const NET_SIZE = 518; // DA-V2 bemenet (14 többszöröse)
const MAX_EDGE = 1600; // a rétegek leghosszabb éle (rendernek bőven elég)

function depthAvailable() {
  return fs.existsSync(MODEL_PATH);
}

/** a kész rétegek mappája egy id-hoz (a render is innen olvas) */
function depthLayerDir(id) {
  return path.join(DEPTH_DIR, id);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs ?? 120000, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} hiba: ${stderr?.toString().slice(-800) || err.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

/** kép → nyers RGB24 buffer a hálózat méretére nyújtva */
async function decodeForNet(imagePath) {
  return run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-vf', `scale=${NET_SIZE}:${NET_SIZE}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
}

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) {
    // az onnxruntime-node csak itt töltődik — modell nélkül a többi endpoint él
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
    });
  }
  return sessionPromise;
}

/**
 * Mélységbecslés: kép → normalizált (0–255, közel = világos) szürke mélységkép
 * PNG-ben, a kért méretre skálázva.
 */
async function estimateDepth(imagePath, outPng, outW, outH) {
  const ort = require('onnxruntime-node');
  const session = await getSession();
  const rgb = await decodeForNet(imagePath);
  const px = NET_SIZE * NET_SIZE;
  // ImageNet-normalizálás, CHW-elrendezés
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) {
      input[c * px + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c];
    }
  }
  const feeds = {};
  feeds[session.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, NET_SIZE, NET_SIZE]);
  const results = await session.run(feeds);
  const depth = results[session.outputNames[0]].data;

  // min–max normalizálás a teljes 0–255 sávra (inverz mélység: közel = nagy)
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] < min) min = depth[i];
    if (depth[i] > max) max = depth[i];
  }
  const span = Math.max(max - min, 1e-6);
  const gray = Buffer.alloc(px);
  for (let i = 0; i < px; i++) {
    gray[i] = Math.round(((depth[i] - min) / span) * 255);
  }

  // nyers gray → PNG a kért méretre (lágyítva, hogy a lépcsők ne látszódjanak)
  const tmpRaw = outPng + '.raw';
  fs.writeFileSync(tmpRaw, gray);
  await run('ffmpeg', [
    '-v', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-s', `${NET_SIZE}x${NET_SIZE}`,
    '-i', tmpRaw,
    '-vf', `scale=${outW}:${outH},gblur=sigma=2`,
    '-frames:v', '1',
    '-y', outPng,
  ]);
  fs.unlinkSync(tmpRaw);
}

/** a kép mérete (a rétegek MAX_EDGE-re korlátozva, páros számra igazítva) */
async function probeSize(imagePath) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    imagePath,
  ]);
  const [w, h] = out.toString().trim().split(',').map(Number);
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const even = (v) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { w: even(w), h: even(h) };
}

/** lágy 0–1 küszöb a mélységképből: smooth((lum−lo)/(hi−lo)) */
function smoothExpr(lo, hi) {
  const p = `min(max((lum(X,Y)-${lo})/${hi - lo},0),1)`;
  return `${p}*${p}*(3-2*${p})`;
}

function alphaExpr(lo, hi) {
  return `255*${smoothExpr(lo, hi)}`;
}

/**
 * Sáv-korlátos alfa a középrétegnek: a fg-tartomány KIZÁRVA. A parallaxnál a
 * fg jobban mozdul, mint a mid — ha a mid is tartalmazná a közeli tartalmat,
 * az elmozdulásnál szellemkép-másolat látszana ki alóla.
 */
function bandAlphaExpr(lo, hi, cutLo, cutHi) {
  return `255*${smoothExpr(lo, hi)}*(1-${smoothExpr(cutLo, cutHi)})`;
}

/**
 * Parallax-rétegek a képből + mélységképből, egyetlen ffmpeg-hívással:
 * fg/mid alfa-maszkok (geq + gblur a lágy szélhez), bg lyuk-kitöltés
 * maskedmerge-dzsel (a közeli tartalom helyén az elmosott kép ül).
 */
async function buildLayers(imagePath, depthPng, dir, w, h) {
  const filter =
    `[0:v]scale=${w}:${h},setsar=1,format=rgba,split=3[pfg][pmid][pbgA];` +
    `[pbgA]split[pbase][pblur];` +
    `[1:v]format=gray,split=4[dfg][dmid][dcut][dhole];` +
    // fg: legközelebbi sáv, lágy széllel
    `[dfg]geq=lum='${alphaExpr(150, 195)}',gblur=sigma=3[afg];` +
    `[pfg][afg]alphamerge[fg];` +
    // mid: középsáv a fg-tartomány NÉLKÜL, és a közeli tartalom körül térben
    // kitágított kill-zónával — a sziluett szélén a mélység-átmenet átmegy a
    // középsávon, és az így bekerülő kontúr-gyűrű a parallaxnál elcsúszó
    // szellemképként látszana
    `[dmid]geq=lum='${bandAlphaExpr(95, 135, 160, 200)}',gblur=sigma=4[amidraw];` +
    `[dcut]geq=lum='${alphaExpr(140, 170)}',gblur=sigma=16,lutyuv=y=negval[acutinv];` +
    `[amidraw][acutinv]blend=all_mode=multiply:shortest=1[amid];` +
    `[pmid][amid]alphamerge[mid];` +
    // bg-lyukak: a közeli tartalom KIFELÉ TÁGÍTOTT maszkja alatt elmosott kép.
    // A tágítás (blur → ×3 erősítés → újralágyítás) kulcsfontosságú: sima
    // feather-nél a maszk a sziluett belső pereménél 1 alá esne, és félig
    // éles kontúr-szellem maradna a háttérrétegben. Mindhárom bemenet
    // explicit gbrp-ben — a szürke maszk különben gray-re tárgyaltatná le a
    // maskedmerge-et, és a bg elvesztené a színeit.
    `[dhole]geq=lum='${alphaExpr(70, 100)}',gblur=sigma=13,` +
    `lutyuv=y='min(val*2.5,255)',gblur=sigma=6,format=gbrp[ahole];` +
    `[pblur]gblur=sigma=24,format=gbrp[pb];` +
    `[pbase]format=gbrp[pbc];` +
    `[pbc][pb][ahole]maskedmerge,format=rgb24[bg]`;
  await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-i', depthPng,
    '-filter_complex', filter,
    '-map', '[fg]', '-frames:v', '1', '-y', path.join(dir, 'fg.png'),
    '-map', '[mid]', '-frames:v', '1', '-y', path.join(dir, 'mid.png'),
    '-map', '[bg]', '-frames:v', '1', '-y', path.join(dir, 'bg.png'),
  ]);
}

/**
 * Fókusz-változatok (🌫️/🎬 depth-extrák) a képből + mélységképből:
 *   focus-near.png — a közeli tartalom éles, a távoli portré-blurt kap,
 *   focus-far.png  — fordítva (a rack-focus animáció másik vége).
 * A maszkok lágy smoothstep-küszöbök; minden bemenet gbrp-ben (lásd
 * buildLayers — a szürke maszk különben elszínteleníti a maskedmerge-et).
 */
async function buildFocusVariants(imagePath, depthPng, dir, w, h) {
  const SM = smoothExpr(110, 160);
  const filter =
    `[0:v]scale=${w}:${h},setsar=1,split=3[s1][s2][sb];` +
    `[sb]gblur=sigma=16,format=gbrp,split=2[b1][b2];` +
    `[1:v]format=gray,split=2[d1][d2];` +
    `[d1]geq=lum='255*(1-${SM})',gblur=sigma=8,format=gbrp[mfar];` +
    `[d2]geq=lum='255*${SM}',gblur=sigma=8,format=gbrp[mnear];` +
    `[s1]format=gbrp[s1c];[s2]format=gbrp[s2c];` +
    `[s1c][b1][mfar]maskedmerge,format=rgb24[near];` +
    `[s2c][b2][mnear]maskedmerge,format=rgb24[far]`;
  await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-i', depthPng,
    '-filter_complex', filter,
    '-map', '[near]', '-frames:v', '1', '-y', path.join(dir, 'focus-near.png'),
    '-map', '[far]', '-frames:v', '1', '-y', path.join(dir, 'focus-far.png'),
  ]);
}

/** md5 + mappa + (cache-elt vagy most számolt) mélységkép a fotóhoz */
async function ensureDepth(imagePath) {
  if (!depthAvailable()) {
    throw new Error('Nincs mélység-modell (LOCAL_DEPTH_MODEL / server/models).');
  }
  const md5 = crypto
    .createHash('md5')
    .update(fs.readFileSync(imagePath))
    .digest('hex');
  const dir = depthLayerDir(md5);
  fs.mkdirSync(dir, { recursive: true });
  const depthPng = path.join(dir, 'depth.png');
  const { w, h } = await probeSize(imagePath);
  if (!fs.existsSync(depthPng)) {
    await estimateDepth(imagePath, depthPng, w, h);
  }
  return { id: md5, dir, depthPng, w, h };
}

/**
 * Fotó → mélység + parallax-rétegek, md5 szerint cache-elve.
 * @returns {Promise<{id: string, dir: string, cached: boolean}>}
 */
async function computeParallaxAssets(imagePath) {
  if (!depthAvailable()) {
    throw new Error('Nincs mélység-modell (LOCAL_DEPTH_MODEL / server/models).');
  }
  const md5 = crypto
    .createHash('md5')
    .update(fs.readFileSync(imagePath))
    .digest('hex');
  const dir = depthLayerDir(md5);
  const ready = ['fg.png', 'mid.png', 'bg.png'].every((f) =>
    fs.existsSync(path.join(dir, f))
  );
  if (ready) {
    return { id: md5, dir, cached: true };
  }
  const { depthPng, w, h } = await ensureDepth(imagePath);
  await buildLayers(imagePath, depthPng, dir, w, h);
  return { id: md5, dir, cached: false };
}

/**
 * Fotó → mélység + fókusz-változatok (portré-blur / rack focus), cache-elve.
 * @returns {Promise<{id: string, dir: string, cached: boolean}>}
 */
async function computeFocusAssets(imagePath) {
  if (!depthAvailable()) {
    throw new Error('Nincs mélység-modell (LOCAL_DEPTH_MODEL / server/models).');
  }
  const md5 = crypto
    .createHash('md5')
    .update(fs.readFileSync(imagePath))
    .digest('hex');
  const dir = depthLayerDir(md5);
  const ready = ['focus-near.png', 'focus-far.png'].every((f) =>
    fs.existsSync(path.join(dir, f))
  );
  if (ready) {
    return { id: md5, dir, cached: true };
  }
  const { depthPng, w, h } = await ensureDepth(imagePath);
  await buildFocusVariants(imagePath, depthPng, dir, w, h);
  return { id: md5, dir, cached: false };
}

module.exports = {
  computeFocusAssets,
  ensureDepth,
  computeParallaxAssets,
  depthAvailable,
  depthLayerDir,
  MODEL_PATH,
};
