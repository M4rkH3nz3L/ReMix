// 🔍 Upscale / Enhance (CC V2): fotó-felnagyítás szuper-felbontással.
//
// Motor: ESPCN (sub-pixel CNN, ONNX Model Zoo) — a LUMA csatornát nagyítja 3×
// valódi részlet-rekonstrukcióval, a színcsatornák lanczos-szal jönnek (a
// szem a fényesség-részletre érzékeny, a színre alig). A háló fix 224×224
// bemenetű, ezért a kép csempékre bomlik átfedéssel, majd összeáll.
// A végső méret a kért nagyítás (2× vagy 4×) lanczos-szal áll be.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL_PATH =
  process.env.LOCAL_UPSCALE_MODEL || path.join(__dirname, 'models', 'superres.onnx');
const CACHE_DIR = path.join(__dirname, 'assets', 'upscale');
const TILE = 224; // a háló bemenete
const NET_SCALE = 3; // a háló nagyítása
const OVERLAP = 16; // csempe-átfedés (a varratok ellen)
const MAX_SIDE = 1600; // ennél nagyobb bemenetet leskálázunk (idő/memória)

function upscaleAvailable() {
  return fs.existsSync(MODEL_PATH);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs ?? 180000, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} hiba: ${stderr?.toString().slice(-500) || err.message}`));
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
      logSeverityLevel: 3,
    });
  }
  return sessionPromise;
}

async function probeSize(file) {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]);
  const [w, h] = out.toString().trim().split(',').map(Number);
  return { w, h };
}

/** a teljes luma-sík felnagyítása csempénként (átfedéssel, varrat nélkül) */
async function upscaleLuma(grayPath, w, h) {
  const ort = require('onnxruntime-node');
  const session = await getSession();
  const src = fs.readFileSync(grayPath);
  const outW = w * NET_SCALE;
  const outH = h * NET_SCALE;
  const dst = Buffer.alloc(outW * outH);
  const step = TILE - OVERLAP;
  const input = new Float32Array(TILE * TILE);

  for (let ty = 0; ty < h; ty += step) {
    for (let tx = 0; tx < w; tx += step) {
      // a csempe a kép szélén "visszahajlik" (edge-clamp), nem fekete
      for (let y = 0; y < TILE; y++) {
        const sy = Math.min(h - 1, ty + y);
        for (let x = 0; x < TILE; x++) {
          const sx = Math.min(w - 1, tx + x);
          input[y * TILE + x] = src[sy * w + sx] / 255;
        }
      }
      const feeds = {};
      feeds[session.inputNames[0]] = new ort.Tensor('float32', input, [1, 1, TILE, TILE]);
      const result = await session.run(feeds);
      const outData = result[session.outputNames[0]].data;
      const oSize = TILE * NET_SCALE;
      // a belső (átfedés-mentes) rész írása a célsíkba
      const half = (OVERLAP / 2) * NET_SCALE;
      const startY = ty === 0 ? 0 : half;
      const startX = tx === 0 ? 0 : half;
      for (let y = startY; y < oSize; y++) {
        const dy = ty * NET_SCALE + y;
        if (dy >= outH) {
          break;
        }
        for (let x = startX; x < oSize; x++) {
          const dx = tx * NET_SCALE + x;
          if (dx >= outW) {
            break;
          }
          const v = outData[y * oSize + x];
          dst[dy * outW + dx] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
      }
    }
  }
  return { data: dst, w: outW, h: outH };
}

/**
 * Kép felnagyítása (md5 + arány szerint cache-elve).
 * @param imagePath forráskép
 * @param opts { scale: 2|4, workDir }
 * @returns {Promise<{file: string, width: number, height: number, cached: boolean}>}
 */
async function upscaleImage(imagePath, opts) {
  if (!upscaleAvailable()) {
    throw new Error('Nincs upscale-modell (LOCAL_UPSCALE_MODEL / server/models).');
  }
  const scale = opts.scale === 4 ? 4 : 2;
  const md5 = crypto.createHash('md5').update(fs.readFileSync(imagePath)).digest('hex');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, `${md5}_x${scale}.png`);
  const { w: srcW, h: srcH } = await probeSize(imagePath);
  if (fs.existsSync(out)) {
    const size = await probeSize(out);
    return { file: out, width: size.w, height: size.h, cached: true };
  }

  // 1) munkaméret (a háló CPU-n fut — a túl nagy bemenet lassú)
  const fit = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * fit));
  const h = Math.max(2, Math.round(srcH * fit));
  const workDir = opts.workDir || CACHE_DIR;
  const grayRaw = path.join(workDir, `${md5}_y.raw`);
  await run('ffmpeg', [
    '-v', 'error', '-i', imagePath,
    '-vf', `scale=${w}:${h},format=gray`,
    '-frames:v', '1', '-f', 'rawvideo', '-y', grayRaw,
  ]);

  // 2) luma 3× a hálóval
  const luma = await upscaleLuma(grayRaw, w, h);
  const lumaRaw = path.join(workDir, `${md5}_y3.raw`);
  fs.writeFileSync(lumaRaw, luma.data);
  fs.rmSync(grayRaw, { force: true });

  // 3) szín lanczos-szal ugyanerre a méretre, majd a HÁLÓS luma beültetése
  //    (mergeplanes: a rekonstruált Y + az eredeti U/V)
  const targetW = Math.round(srcW * scale / 2) * 2;
  const targetH = Math.round(srcH * scale / 2) * 2;
  await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${luma.w}x${luma.h}`, '-i', lumaRaw,
    '-filter_complex',
    `[0:v]scale=${luma.w}:${luma.h}:flags=lanczos,format=yuv444p,extractplanes=u+v[u][v];` +
      `[1:v]format=gray[y];[y][u][v]mergeplanes=0x001020:yuv444p,` +
      `scale=${targetW}:${targetH}:flags=lanczos,` +
      // finom élesítés a végén — a szuper-felbontás után természetes marad
      `unsharp=5:5:0.6:5:5:0.0,format=rgb24[out]`,
    '-map', '[out]', '-frames:v', '1', '-y', out,
  ]);
  fs.rmSync(lumaRaw, { force: true });
  return { file: out, width: targetW, height: targetH, cached: false };
}

module.exports = { upscaleAvailable, upscaleImage, MODEL_PATH };
