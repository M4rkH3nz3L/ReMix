// 🙂 Arc-detektor (P0-6/P0-7 bővítés): UltraFace RFB-320 ONNX-ben, CPU-n
// (~1,2 MB, MIT licenc — az onnx/models validated gyűjteményéből; cseréje a
// LOCAL_FACE_MODEL env-vel). A képkocka a VÁSZON arányára paddelve megy a
// hálóba (mint a trackernél), így a visszaadott dobozok közvetlenül
// vászon-normalizáltak — a kliens pozíció/követés azonnal használhatja.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL_PATH =
  process.env.LOCAL_FACE_MODEL ||
  path.join(__dirname, 'models', 'ultraface-rfb-320.onnx');
const NET_W = 320;
const NET_H = 240;
const SCORE_THRESHOLD = 0.7;
const IOU_THRESHOLD = 0.3;

function faceAvailable() {
  return fs.existsSync(MODEL_PATH);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 60000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} hiba: ${stderr?.toString().slice(-400) || err.message}`));
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
      // a régi exportőrrel készült modell sok ártalmatlan warningot ír — némítva
      logSeverityLevel: 3,
    });
  }
  return sessionPromise;
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / Math.max(1e-9, areaA + areaB - inter);
}

/**
 * Arcok egy képkockán.
 * @param file médiafájl
 * @param opts { atSec?, aspectW, aspectH } — a vászon aránya
 * @returns {Promise<{faces: {x,y,w,h,score}[]}>} középpont+méret, vászon-normalizált
 */
async function detectFaces(file, opts) {
  if (!faceAvailable()) {
    throw new Error('Nincs arc-modell (LOCAL_FACE_MODEL / server/models).');
  }
  const ort = require('onnxruntime-node');
  const session = await getSession();
  const atSec = opts.atSec ?? 0;
  // 1) vászon-arányú keretbe illesztés (mint a tracker), 2) nyújtás a hálóra
  const padW = 640;
  const padH = Math.round(((padW * opts.aspectH) / opts.aspectW) / 2) * 2;
  const seek = atSec > 0.001 ? ['-ss', String(atSec)] : [];
  const rgb = await run('ffmpeg', [
    '-v', 'error',
    ...seek,
    '-i', file,
    '-vf',
    `scale=${padW}:${padH}:force_original_aspect_ratio=decrease,` +
      `pad=${padW}:${padH}:(ow-iw)/2:(oh-ih)/2,scale=${NET_W}:${NET_H}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
  const px = NET_W * NET_H;
  if (rgb.length < px * 3) {
    throw new Error('Nem sikerült képkockát olvasni.');
  }
  // UltraFace-előfeldolgozás: (érték − 127) / 128, CHW
  const input = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) {
      input[c * px + i] = (rgb[i * 3 + c] - 127) / 128;
    }
  }
  const feeds = { input: new ort.Tensor('float32', input, [1, 3, NET_H, NET_W]) };
  const results = await session.run(feeds);
  const scores = results.scores.data; // [1, N, 2]
  const boxes = results.boxes.data; // [1, N, 4] — x1,y1,x2,y2 normalizálva
  const n = scores.length / 2;

  const candidates = [];
  for (let i = 0; i < n; i++) {
    const score = scores[i * 2 + 1];
    if (score < SCORE_THRESHOLD) {
      continue;
    }
    candidates.push({
      score,
      x1: boxes[i * 4],
      y1: boxes[i * 4 + 1],
      x2: boxes[i * 4 + 2],
      y2: boxes[i * 4 + 3],
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of candidates) {
    if (kept.every((k) => iou(k, c) < IOU_THRESHOLD)) {
      kept.push(c);
    }
    if (kept.length >= 10) {
      break;
    }
  }
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    faces: kept.map((f) => ({
      x: round((f.x1 + f.x2) / 2),
      y: round((f.y1 + f.y2) / 2),
      w: round(f.x2 - f.x1),
      h: round(f.y2 - f.y1),
      score: Math.round(f.score * 100) / 100,
    })),
  };
}

module.exports = { detectFaces, faceAvailable, MODEL_PATH };
