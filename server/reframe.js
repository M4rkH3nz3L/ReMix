// Auto Reframe (P0-7): a téma útvonalának becslése mozgás-centroiddal —
// függőség-mentesen. Kis szürke képkockákon a szomszédos kockák különbségének
// súlypontja adja a "hol történik valami" pontot; alacsony mozgásnál a
// részlet-gazdagság (lokális variancia) súlypontja tart célban. A kimenet
// FORRÁS-normalizált középpont-út — a kliens fordítja crop/pan kulcskockákká.
// A motor később face/saliency-detektorra cserélhető, a kimenet marad.
const { spawn } = require('child_process');
const { execFile } = require('child_process');

const RF_W = 320;
const DIFF_THRESHOLD = 18;
const MIN_MOTION_FRACTION = 0.002; // ez alatt "nincs mozgás"
const EMA_ALPHA = 0.25; // út-simítás

function probeSize(file) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
       '-of', 'csv=p=0', file],
      { timeout: 30 * 1000 },
      (err, stdout) => {
        if (err) {
          reject(new Error('ffprobe hiba'));
          return;
        }
        const [w, h] = stdout.trim().split(',').map((v) => parseInt(v, 10));
        if (!w || !h) {
          reject(new Error('Ismeretlen videó-méret.'));
          return;
        }
        resolve({ width: w, height: h });
      }
    );
  });
}

function decodeGray(file, { startSec, durationSec, fps, W, H }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-ss', String(startSec), '-t', String(durationSec), '-i', file,
       '-vf', `fps=${fps},scale=${W}:${H},format=gray`, '-f', 'rawvideo', 'pipe:1'],
      { timeout: 5 * 60 * 1000 }
    );
    const chunks = [];
    let total = 0;
    let stderrTail = '';
    child.stdout.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > 256 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('Túl hosszú szakasz.'));
      }
    });
    child.stderr.on('data', (c) => {
      stderrTail = (stderrTail + c.toString()).slice(-400);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg hiba: ${stderrTail}`));
        return;
      }
      const buf = Buffer.concat(chunks, total);
      resolve({ frames: buf, count: Math.floor(buf.length / (W * H)) });
    });
  });
}

/** részlet-súlypont: 8x8 blokkok lokális kontrasztjának centroidja */
function detailCentroid(frames, base, W, H) {
  const B = 8;
  let sumW = 0;
  let sx = 0;
  let sy = 0;
  for (let by = 0; by + B <= H; by += B) {
    for (let bx = 0; bx + B <= W; bx += B) {
      let min = 255;
      let max = 0;
      for (let y = 0; y < B; y += 2) {
        const row = base + (by + y) * W + bx;
        for (let x = 0; x < B; x += 2) {
          const v = frames[row + x];
          if (v < min) {
            min = v;
          }
          if (v > max) {
            max = v;
          }
        }
      }
      const contrast = max - min;
      if (contrast > 20) {
        sumW += contrast;
        sx += (bx + B / 2) * contrast;
        sy += (by + B / 2) * contrast;
      }
    }
  }
  if (sumW === 0) {
    return { x: W / 2, y: H / 2 };
  }
  return { x: sx / sumW, y: sy / sumW };
}

/** A motor magja — pure, tesztelhető: nyers kockák → simított középpont-út. */
function motionPath(frames, W, H, count, fps) {
  const frameSize = W * H;
  let cx = W / 2;
  let cy = H / 2;
  const points = [];
  for (let f = 0; f < count; f++) {
    const base = f * frameSize;
    let target = null;
    if (f > 0) {
      const prev = (f - 1) * frameSize;
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < frameSize; i += 2) {
        const d = frames[base + i] - frames[prev + i];
        if (d > DIFF_THRESHOLD || d < -DIFF_THRESHOLD) {
          n++;
          sx += i % W;
          sy += (i / W) | 0;
        }
      }
      if (n >= (frameSize / 2) * MIN_MOTION_FRACTION) {
        target = { x: sx / n, y: sy / n };
      }
    }
    if (!target) {
      target = detailCentroid(frames, base, W, H);
    }
    // EMA-simítás — a crop ne ugráljon
    cx += (target.x - cx) * EMA_ALPHA;
    cy += (target.y - cy) * EMA_ALPHA;
    points.push({
      t: Math.round((f / fps) * 1000) / 1000,
      x: Math.round((cx / W) * 1000) / 1000,
      y: Math.round((cy / H) * 1000) / 1000,
    });
  }
  return points;
}

/**
 * 🙂 Arc-horgonyok: ritkás mintavétel a szakaszon (az UltraFace gyors, de nem
 * futtatjuk minden kockára). A detektor a FORRÁS arányával hívva forrás-
 * normalizált középpontot ad (a vászon-pad ilyenkor no-op).
 */
async function sampleFaceAnchors(file, { startSec, durationSec, width, height }) {
  let face;
  try {
    face = require('./face');
  } catch {
    return [];
  }
  if (!face.faceAvailable()) {
    return [];
  }
  const K = Math.max(2, Math.min(8, Math.round(durationSec / 1.2)));
  const anchors = [];
  for (let i = 0; i < K; i++) {
    const rel = (durationSec * (i + 0.5)) / K;
    try {
      const { faces } = await face.detectFaces(file, {
        atSec: startSec + rel,
        aspectW: width,
        aspectH: height,
      });
      if (faces.length > 0) {
        const best = [...faces].sort(
          (a, b) => b.score * b.w * b.h - a.score * a.w * a.h
        )[0];
        anchors.push({ t: rel, x: best.x, y: best.y });
      }
    } catch {
      // egy-egy kocka kimaradhat — a mozgás-út úgyis megvan
    }
  }
  return anchors;
}

/**
 * A mozgás-út keverése az arc-horgonyokkal — pure, tesztelhető. Ahol időben
 * közel van arc (interpolálva két horgony közt), ott az arc dominál (70%);
 * ahol nincs, marad a mozgás-centroid. A határokat könnyű EMA simítja.
 */
function blendFacePath(points, anchors, faceWeight = 0.7) {
  if (anchors.length === 0) {
    return points;
  }
  const NEAR = 1.5; // mp — ha a legközelebbi horgony ennél messzebb van, nem érvényes
  const faceAt = (t) => {
    let before = null;
    let after = null;
    let nearest = Infinity;
    for (const a of anchors) {
      if (a.t <= t && (!before || a.t > before.t)) {
        before = a;
      }
      if (a.t >= t && (!after || a.t < after.t)) {
        after = a;
      }
      nearest = Math.min(nearest, Math.abs(a.t - t));
    }
    if (nearest > NEAR) {
      return null; // nagy lyuk — lehet, hogy az arc kiment a képből, a mozgás-út él
    }
    if (before && after && after.t - before.t > 0.001) {
      const p = (t - before.t) / (after.t - before.t);
      return { x: before.x + (after.x - before.x) * p, y: before.y + (after.y - before.y) * p };
    }
    const single = before ?? after;
    return { x: single.x, y: single.y };
  };
  let sx = null;
  let sy = null;
  return points.map((p) => {
    const f = faceAt(p.t);
    let x = f ? f.x * faceWeight + p.x * (1 - faceWeight) : p.x;
    let y = f ? f.y * faceWeight + p.y * (1 - faceWeight) : p.y;
    // könnyű simítás a mozgás↔arc határokon
    sx = sx === null ? x : sx + (x - sx) * 0.45;
    sy = sy === null ? y : sy + (y - sy) * 0.45;
    x = sx;
    y = sy;
    return { t: p.t, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  });
}

/**
 * @param file médiafájl
 * @param opts { startSec, durationSec, fps? }
 * @returns {Promise<{width,height,faceAnchors,points:[{t,x,y}]}>} — x/y forrás-normalizált
 */
async function analyzeReframe(file, opts) {
  const fps = opts.fps ?? 6;
  const { width, height } = await probeSize(file);
  const H = Math.max(2, Math.round((RF_W * height) / width / 2) * 2);
  const { frames, count } = await decodeGray(file, {
    startSec: opts.startSec,
    durationSec: opts.durationSec,
    fps,
    W: RF_W,
    H,
  });
  if (count < 1) {
    throw new Error('Nem sikerült képkockát kinyerni.');
  }
  const motion = motionPath(frames, RF_W, H, count, fps);
  const anchors = await sampleFaceAnchors(file, {
    startSec: opts.startSec,
    durationSec: opts.durationSec,
    width,
    height,
  });
  return {
    width,
    height,
    faceAnchors: anchors.length,
    points: blendFacePath(motion, anchors),
  };
}

module.exports = { analyzeReframe, blendFacePath, motionPath };
