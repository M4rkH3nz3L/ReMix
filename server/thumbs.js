// Thumbnail Studio (Creative Canvas): a videó legjobb borítókép-kockáinak
// kiválasztása — függőség-mentes pontozással: élesség (Laplace-variancia) +
// kontraszt (szórás) + fényerő-büntetés a túl sötét/világos kockákra.
// A jelöltek másodpercenként jönnek, a győztesek időben szétszórva.
const { execFile, spawn } = require('child_process');
const path = require('path');

const TH_W = 160;
/** két kiválasztott kocka közt legalább ennyi idő legyen (mp) */
const MIN_SPACING = 1.5;

function decodeGray(file, fps, W) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${W}:-2,format=gray`,
       '-f', 'rawvideo', 'pipe:1'],
      { timeout: 5 * 60 * 1000 }
    );
    const chunks = [];
    let total = 0;
    child.stdout.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > 128 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('Túl hosszú videó a borítókép-elemzéshez.'));
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('ffmpeg dekódolás hiba'));
        return;
      }
      resolve(Buffer.concat(chunks, total));
    });
  });
}

async function probeSize(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
       '-of', 'csv=p=0', file],
      { timeout: 30 * 1000 },
      (err, stdout) => {
        if (err) {
          resolve({ width: 16, height: 9 });
          return;
        }
        const [w, h] = stdout.trim().split(',').map((v) => parseInt(v, 10));
        resolve({ width: w || 16, height: h || 9 });
      }
    );
  });
}

/** egy szürke kocka pontszáma — pure, tesztelhető */
function scoreFrame(frames, offset, W, H) {
  let sum = 0;
  let sumSq = 0;
  let lap = 0;
  const n = W * H;
  for (let y = 1; y < H - 1; y++) {
    const row = offset + y * W;
    for (let x = 1; x < W - 1; x++) {
      const v = frames[row + x];
      sum += v;
      sumSq += v * v;
      const l =
        4 * v -
        frames[row + x - 1] -
        frames[row + x + 1] -
        frames[row - W + x] -
        frames[row + W + x];
      lap += l * l;
    }
  }
  const inner = (W - 2) * (H - 2);
  const mean = sum / inner;
  const variance = sumSq / inner - mean * mean;
  const contrast = Math.sqrt(Math.max(variance, 0));
  const sharpness = Math.sqrt(lap / inner);
  // a középszürkétől távoli (túl sötét/kiégett) kockák büntetése
  const brightnessPenalty = Math.abs(mean - 118) / 118;
  void n;
  return {
    score: Math.round((sharpness * 1.5 + contrast - brightnessPenalty * 40) * 10) / 10,
    // átlag-fényerő 0–1 (expozíció-elemzéshez): a szürke átlag normalizálva
    luma: Math.round((mean / 255) * 1000) / 1000,
  };
}

/** pontozott jelöltekből a legjobbak, időbeli szétszórással — pure */
function pickBest(scored, count, minSpacing = MIN_SPACING) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const picked = [];
  for (const cand of sorted) {
    if (picked.length >= count) {
      break;
    }
    if (picked.every((p) => Math.abs(p.t - cand.t) >= minSpacing)) {
      picked.push(cand);
    }
  }
  return picked.sort((a, b) => a.t - b.t);
}

/**
 * 🙂 arc-bónusz egy jelölt-kockára: nagy, középre komponált arc = jobb borító.
 * Az UltraFace a forrás arányával hívva forrás-normalizált dobozt ad.
 */
async function faceBonusFor(file, t, width, height) {
  try {
    const face = require('./face');
    if (!face.faceAvailable()) {
      return { bonus: 0, faces: 0 };
    }
    const { faces } = await face.detectFaces(file, {
      atSec: t,
      aspectW: width,
      aspectH: height,
    });
    if (faces.length === 0) {
      return { bonus: 0, faces: 0 };
    }
    const best = [...faces].sort(
      (a, b) => b.score * b.w * b.h - a.score * a.w * a.h
    )[0];
    const size = Math.min(1, best.w * 2.5);
    const central = 1 - Math.min(1, Math.abs(best.x - 0.5) * 2);
    return {
      bonus: Math.round((30 * best.score * size + 12 * central) * 10) / 10,
      faces: faces.length,
    };
  } catch {
    return { bonus: 0, faces: 0 };
  }
}

/**
 * @param file médiafájl
 * @param opts { count?, workDir }
 * @returns {Promise<[{t, score, faces, file}]>} — teljes felbontású JPEG-ek
 */
async function pickThumbnails(file, opts) {
  const count = Math.min(6, Math.max(1, opts.count ?? 4));
  const { width, height } = await probeSize(file);
  const H = Math.max(2, Math.round((TH_W * height) / width / 2) * 2);
  const frames = await decodeGray(file, 1, TH_W);
  const frameSize = TH_W * H;
  const total = Math.floor(frames.length / frameSize);
  if (total === 0) {
    throw new Error('Nem sikerült képkockát kinyerni.');
  }
  const scored = [];
  for (let i = 0; i < total; i++) {
    scored.push({ t: i + 0.5, score: scoreFrame(frames, i * frameSize, TH_W, H).score });
  }
  // két kör: az alap-pontszám legjobbjain (szűkebb pool) fut az arc-detektor,
  // és a bónusszal frissített pontszámból jön a végső válogatás
  const pool = pickBest(scored, Math.max(count * 3, 10), 1.0);
  for (const cand of pool) {
    const fb = await faceBonusFor(file, cand.t, width, height);
    cand.score = Math.round((cand.score + fb.bonus) * 10) / 10;
    cand.faces = fb.faces;
  }
  const best = pickBest(pool, count);
  const out = [];
  for (let i = 0; i < best.length; i++) {
    const jpg = path.join(opts.workDir, `thumb_${i}.jpg`);
    await new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-y', '-v', 'error', '-ss', String(best[i].t), '-i', file,
         '-frames:v', '1', '-q:v', '3', jpg],
        { timeout: 60 * 1000 },
        (err) => (err ? reject(new Error('kocka-kinyerés hiba')) : resolve())
      );
    });
    out.push({ t: best[i].t, score: best[i].score, faces: best[i].faces ?? 0, file: jpg });
  }
  return out;
}

function findChromium() {
  const os = require('os');
  const fs = require('fs');
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) {
        return bin;
      }
    }
  } catch {
    // nincs playwright-cache
  }
  return null;
}

/**
 * 🎬 Headline ráégetése a borítóra: vastag, fekete-kontúros felirat az alsó
 * harmadban — a Chromium-raszter írja (a helyi ffmpeg drawtext nélkül épült,
 * és a CSS-kontúr amúgy is szebb), majd ffmpeg overlay égeti a JPEG-re.
 */
async function composeThumbnail(imageFile, headline, workDir) {
  const fs = require('fs');
  const { width } = await probeSize(imageFile);
  const clean = String(headline).trim().slice(0, 34);
  const fontPx = Math.round(
    Math.min(width / 6.5, Math.max(width / 15, (width * 1.5) / Math.max(6, clean.length)))
  );
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs Chromium headless shell a headline-égetéshez.');
  }
  const esc = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const stroke = Math.max(2, Math.round(fontPx * 0.09));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    #t{display:inline-block;max-width:${Math.round(width * 0.92)}px;padding:${stroke * 2}px;
      font:900 ${fontPx}px -apple-system,'Helvetica Neue',sans-serif;color:#fff;
      -webkit-text-stroke:${stroke}px #000;paint-order:stroke fill;
      text-align:center;line-height:1.05;letter-spacing:-0.5px}
  </style></head><body><span id="t">${esc}</span></body></html>`;
  const htmlFile = path.join(workDir, 'headline.html');
  fs.writeFileSync(htmlFile, html);

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath });
  const png = path.join(workDir, 'headline.png');
  try {
    const page = await browser.newPage({ viewport: { width: width || 1280, height: 800 } });
    await page.goto(`file://${htmlFile}`, { waitUntil: 'load' });
    await page.locator('#t').screenshot({ path: png, omitBackground: true });
  } finally {
    await browser.close();
  }

  const out = path.join(workDir, 'composed.jpg');
  await new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', imageFile, '-i', png,
       '-filter_complex', '[0:v][1:v]overlay=x=(W-w)/2:y=H-h-H*0.05',
       '-q:v', '3', out],
      { timeout: 60 * 1000 },
      (err, _o, stderr) =>
        err ? reject(new Error(`headline-égetés hiba: ${stderr?.slice(-300)}`)) : resolve()
    );
  });
  return out;
}

/**
 * 🏆 Best-shot pontozás (P0‑1): adott forrás-időpontok vizuális minősége —
 * élesség + kontraszt (scoreFrame) + arc-bónusz. Az Auto Edit ebből tudja,
 * melyik pillanat NÉZ KI jól, nem csak melyikben van beszéd/jelenet.
 */
async function scoreShots(file, times) {
  const { width, height } = await probeSize(file);
  const H = Math.max(2, Math.round((TH_W * height) / width / 2) * 2);
  const out = [];
  for (const t of times.slice(0, 24)) {
    const seek = t > 0.001 ? ['-ss', String(t)] : [];
    const gray = await new Promise((resolve) => {
      execFile(
        'ffmpeg',
        ['-v', 'error', ...seek, '-i', file, '-vf', `scale=${TH_W}:${H},format=gray`,
         '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'],
        { timeout: 30 * 1000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
        (err, stdout) => resolve(err ? null : stdout)
      );
    });
    if (!gray || gray.length < TH_W * H) {
      continue;
    }
    const frame = scoreFrame(gray, 0, TH_W, H);
    const fb = await faceBonusFor(file, t, width, height);
    out.push({
      t,
      score: Math.round((frame.score + fb.bonus) * 10) / 10,
      luma: frame.luma,
      faces: fb.faces,
    });
  }
  return out;
}

module.exports = { composeThumbnail, pickThumbnails, scoreFrame, scoreShots, pickBest };
