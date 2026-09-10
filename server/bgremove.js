// 🪄 AI background removal (P1, v1 — fotón): u2net saliency-modell ONNX-ben,
// CPU-n (a rembg modellje, Apache 2.0) — a GPU-döntés a VIDEÓS változatra
// marad, fotón a CPU bőven elég (~1-2 mp/kép). A modell a LOCAL_BGREMOVE_MODEL
// env-vel cserélhető. A kimenet: alpha.png (a téma maszkja) + cutout.png
// (a fotó átlátszó háttérrel) — a kliens a kivágást overlay-képként használja.
//
// Cache: assets/bgremove/<md5(kép)>/ — worker-újraindítás után is él.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL_PATH =
  process.env.LOCAL_BGREMOVE_MODEL ||
  path.join(__dirname, 'models', 'u2net.onnx');
const BG_DIR = path.join(__dirname, 'assets', 'bgremove');
const NET_SIZE = 320; // u2net bemenet
const MAX_EDGE = 1600;

function bgRemoveAvailable() {
  return fs.existsSync(MODEL_PATH);
}

function bgRemoveDir(id) {
  return path.join(BG_DIR, id);
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

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) {
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
    });
  }
  return sessionPromise;
}

/** a kép mérete (MAX_EDGE-re korlátozva, páros számra igazítva) */
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

/**
 * Téma-maszk becslése: kép → u2net saliency → normalizált alpha PNG a kért
 * méretre (lágyítva + enyhe kontraszt-húzás, hogy a szél tiszta legyen).
 */
async function estimateAlpha(imagePath, outPng, outW, outH) {
  const ort = require('onnxruntime-node');
  const session = await getSession();
  const rgb = await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-vf', `scale=${NET_SIZE}:${NET_SIZE}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
  const px = NET_SIZE * NET_SIZE;
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
  // az u2net több kimenetet ad (d0..d6) — az első a finomított saliency
  const sal = results[session.outputNames[0]].data;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < px; i++) {
    if (sal[i] < min) min = sal[i];
    if (sal[i] > max) max = sal[i];
  }
  const span = Math.max(max - min, 1e-6);
  const gray = Buffer.alloc(px);
  for (let i = 0; i < px; i++) {
    gray[i] = Math.round(((sal[i] - min) / span) * 255);
  }

  const tmpRaw = outPng + '.raw';
  fs.writeFileSync(tmpRaw, gray);
  // enyhe S-görbe a maszkra: a bizonytalan középső sáv szűkül, a szél lágy marad
  await run('ffmpeg', [
    '-v', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-s', `${NET_SIZE}x${NET_SIZE}`,
    '-i', tmpRaw,
    '-vf',
    `scale=${outW}:${outH},gblur=sigma=1.5,` +
      `geq=lum='255*min(max((lum(X,Y)/255-0.25)/0.5,0),1)'`,
    '-frames:v', '1',
    '-y', outPng,
  ]);
  fs.unlinkSync(tmpRaw);
}

/**
 * Fotó → téma-kivágás (alpha + cutout), md5 szerint cache-elve.
 * @returns {Promise<{id: string, dir: string, cached: boolean}>}
 */
async function computeCutout(imagePath) {
  if (!bgRemoveAvailable()) {
    throw new Error('Nincs kivágás-modell (LOCAL_BGREMOVE_MODEL / server/models).');
  }
  const md5 = crypto
    .createHash('md5')
    .update(fs.readFileSync(imagePath))
    .digest('hex');
  const dir = bgRemoveDir(md5);
  if (fs.existsSync(path.join(dir, 'cutout.png'))) {
    return { id: md5, dir, cached: true };
  }
  fs.mkdirSync(dir, { recursive: true });
  const { w, h } = await probeSize(imagePath);
  const alphaPng = path.join(dir, 'alpha.png');
  await estimateAlpha(imagePath, alphaPng, w, h);
  // kivágás: a fotó + a maszk alfaként összefésülve
  await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-i', alphaPng,
    '-filter_complex',
    `[0:v]scale=${w}:${h},setsar=1,format=rgba[img];` +
      `[1:v]format=gray[a];[img][a]alphamerge[out]`,
    '-map', '[out]',
    '-frames:v', '1',
    '-y', path.join(dir, 'cutout.png'),
  ]);
  return { id: md5, dir, cached: false };
}

module.exports = { bgRemoveAvailable, bgRemoveDir, computeCutout, MODEL_PATH };
