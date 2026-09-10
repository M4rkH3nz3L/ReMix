// Pont-követés (P0-6 tracking): függőség-mentes NCC template-tracker.
// A videóból kis felbontású, a VÁSZON arányára paddelt szürke képkockák
// készülnek (így a koordináták közvetlenül vászon-normalizáltak), majd az
// első képkockán a kért pont körüli minta (template) képkockáról képkockára
// lokális kereséssel követődik. MediaPipe/OpenCV-re cserélhető később —
// a kimenet ugyanaz a pont-sor marad.
const { spawn } = require('child_process');

const TRACK_W = 320;
const SEARCH_RADIUS = 24; // px — ennyit mozoghat a téma két kocka közt
const MIN_SCORE = 0.3; // ez alatt elveszett a követés

/** szürke rawvideo képkockák a vászon-arányra paddelve */
function decodeFrames(file, { startSec, durationSec, fps, aspectW, aspectH }) {
  const H = Math.round((TRACK_W * aspectH) / aspectW / 2) * 2;
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-ss', String(startSec),
      '-t', String(durationSec),
      '-i', file,
      '-vf',
      `fps=${fps},scale=${TRACK_W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${TRACK_W}:${H}:(ow-iw)/2:(oh-ih)/2,format=gray`,
      '-f', 'rawvideo', 'pipe:1',
    ];
    const child = spawn('ffmpeg', args, { timeout: 5 * 60 * 1000 });
    const chunks = [];
    let total = 0;
    let stderrTail = '';
    child.stdout.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > 256 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('Túl hosszú szakasz a követéshez.'));
      }
    });
    child.stderr.on('data', (c) => {
      stderrTail = (stderrTail + c.toString()).slice(-400);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg dekódolás hiba: ${stderrTail}`));
        return;
      }
      const buf = Buffer.concat(chunks, total);
      const frameSize = TRACK_W * H;
      resolve({
        frames: buf,
        W: TRACK_W,
        H,
        count: Math.floor(buf.length / frameSize),
      });
    });
  });
}

/**
 * A tracker magja — pure, tesztelhető: nyers szürke képkockák + kezdőpont →
 * pont-sor. A template az első kockából jön, és lassan (5%) frissül, hogy a
 * lassú kinézet-változást kövesse, de ne "ússzon el".
 *
 * 🧊 3D tracking (multi-scale): a pont mellett a téma LÁTSZÓ MÉRETE is
 * követve van — képkockánként a template három skálán (−4% / = / +4%) is
 * illesztésre kerül (a jelölt-folt bilineárisan mintázódik vissza a template
 * méretére), és a legjobb illeszkedés skálája halmozódik az `s` szorzóban.
 * Az s = közeledés/távolodás → a ráültetett grafika méret-kulcskockái.
 */
function trackCore(frames, W, H, count, cx, cy, fps) {
  const patch = Math.max(16, Math.round(W * 0.14));
  const half = Math.floor(patch / 2);

  let posX = Math.max(half, Math.min(W - half - 1, Math.round(cx * W)));
  let posY = Math.max(half, Math.min(H - half - 1, Math.round(cy * H)));
  let scale = 1; // a téma látszó mérete az induláshoz képest
  const SCALE_STEPS = [0.96, 1, 1.04];
  const SCALE_MIN = 0.5;
  const SCALE_MAX = 2.4;

  const frameSize = W * H;
  const tpl = new Float64Array(patch * patch);

  /** s-szeres folt (ps = patch·s) bilineáris visszamintázása patch×patch-re */
  const readPatchScaled = (frameIdx, x0, y0, s, out) => {
    const base = frameIdx * frameSize;
    const step = s; // forrás-px / template-px
    const start = -half * step;
    for (let y = 0; y < patch; y++) {
      const sy = y0 + start + y * step;
      const iy = Math.max(0, Math.min(H - 2, Math.floor(sy)));
      const fy = Math.max(0, Math.min(1, sy - iy));
      for (let x = 0; x < patch; x++) {
        const sx = x0 + start + x * step;
        const ix = Math.max(0, Math.min(W - 2, Math.floor(sx)));
        const fx = Math.max(0, Math.min(1, sx - ix));
        const i00 = base + iy * W + ix;
        const v =
          frames[i00] * (1 - fx) * (1 - fy) +
          frames[i00 + 1] * fx * (1 - fy) +
          frames[i00 + W] * (1 - fx) * fy +
          frames[i00 + W + 1] * fx * fy;
        out[y * patch + x] = v;
      }
    }
  };
  const stats = (arr) => {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    const mean = sum / arr.length;
    let varSum = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mean;
      varSum += d * d;
    }
    return { mean, norm: Math.sqrt(varSum) };
  };

  // a folt sugara s skálán — a pozíció-clamp ehhez igazodik
  const clampXs = (v, s) => {
    const r = Math.ceil(half * s) + 1;
    return Math.max(r, Math.min(W - r - 1, v));
  };
  const clampYs = (v, s) => {
    const r = Math.ceil(half * s) + 1;
    return Math.max(r, Math.min(H - r - 1, v));
  };

  readPatchScaled(0, posX, posY, 1, tpl);
  let tplStats = stats(tpl);

  const cand = new Float64Array(patch * patch);
  const points = [{ t: 0, x: posX / W, y: posY / H, s: 1, score: 1 }];

  const nccAt = (f, nx, ny, s) => {
    readPatchScaled(f, nx, ny, s, cand);
    const cs = stats(cand);
    if (cs.norm < 1e-6 || tplStats.norm < 1e-6) {
      return -2;
    }
    let dot = 0;
    for (let i = 0; i < cand.length; i++) {
      dot += (cand[i] - cs.mean) * (tpl[i] - tplStats.mean);
    }
    return dot / (cs.norm * tplStats.norm);
  };

  for (let f = 1; f < count; f++) {
    // 1) pozíció: durva rács (2 px lépés) a jelenlegi skálán, finomítás ±1 px
    let bestScore = -2;
    let bestX = posX;
    let bestY = posY;
    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy += 2) {
      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += 2) {
        const score = nccAt(f, clampXs(posX + dx, scale), clampYs(posY + dy, scale), scale);
        if (score > bestScore) {
          bestScore = score;
          bestX = clampXs(posX + dx, scale);
          bestY = clampYs(posY + dy, scale);
        }
      }
    }
    const coarseX = bestX;
    const coarseY = bestY;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const score = nccAt(f, clampXs(coarseX + dx, scale), clampYs(coarseY + dy, scale), scale);
        if (score > bestScore) {
          bestScore = score;
          bestX = clampXs(coarseX + dx, scale);
          bestY = clampYs(coarseY + dy, scale);
        }
      }
    }
    if (bestScore < MIN_SCORE) {
      break; // elveszett — az eddigi pálya megy vissza
    }
    // 2) skála: a legjobb pozíción ±4% kipróbálva
    let bestScale = scale;
    for (const m of SCALE_STEPS) {
      if (m === 1) {
        continue; // a jelenlegi skála pontszáma már megvan
      }
      const s2 = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale * m));
      const score = nccAt(f, clampXs(bestX, s2), clampYs(bestY, s2), s2);
      if (score > bestScore) {
        bestScore = score;
        bestScale = s2;
      }
    }
    posX = clampXs(bestX, bestScale);
    posY = clampYs(bestY, bestScale);
    scale = bestScale;
    // lassú template-frissítés (drift ellen csak 5%) — a téma skáláján olvasva
    readPatchScaled(f, posX, posY, scale, cand);
    for (let i = 0; i < tpl.length; i++) {
      tpl[i] = tpl[i] * 0.95 + cand[i] * 0.05;
    }
    tplStats = stats(tpl);
    points.push({
      t: f / fps,
      x: posX / W,
      y: posY / H,
      s: Math.round(scale * 1000) / 1000,
      score: Math.round(bestScore * 100) / 100,
    });
  }
  return points;
}

/**
 * @param file médiafájl
 * @param opts { startSec, durationSec, cx, cy, fps?, aspectW, aspectH }
 * @returns {Promise<{points: {t,x,y,score}[]}>} — t a startSec-től, x/y vászon-normalizált
 */
async function trackMedia(file, opts) {
  const fps = opts.fps ?? 10;
  const { frames, W, H, count } = await decodeFrames(file, {
    startSec: opts.startSec,
    durationSec: opts.durationSec,
    fps,
    aspectW: opts.aspectW,
    aspectH: opts.aspectH,
  });
  if (count < 2) {
    throw new Error('Túl rövid szakasz a követéshez.');
  }
  return { points: trackCore(frames, W, H, count, opts.cx, opts.cy, fps) };
}

module.exports = { trackMedia, trackCore };
