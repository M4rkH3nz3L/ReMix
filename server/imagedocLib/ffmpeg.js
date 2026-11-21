// 🎨 Kép-dokumentum — az ffmpeg-futtatás és a kimeneti formátum (png/jpg/webp) argumentumai.
const { execFile } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).slice(-1500))) : resolve()
    );
  });
}

/**
 * A kimeneti formátum ffmpeg-argumentumai + kiterjesztés. A `quality` 0–1 (1 = a
 * legjobb). PNG = veszteségmentes, alfával; JPG = nincs alfa (az átlátszó rész
 * feketére lapul), q:v 2–31; WebP = alfás, 0–100 minőség.
 */
function imageOutputArgs(format, quality) {
  const q = Math.max(0, Math.min(1, Number.isFinite(quality) ? quality : 0.92));
  switch (String(format || 'png').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      // 2 (legjobb) … 31 (legrosszabb); az alfát le kell lapítani
      return { ext: 'jpg', args: ['-pix_fmt', 'yuv420p', '-q:v', String(Math.round(2 + (1 - q) * 29))] };
    case 'webp':
      return { ext: 'webp', args: ['-c:v', 'libwebp', '-lossless', '0', '-quality', String(Math.round(q * 100))] };
    case 'png':
    default:
      return { ext: 'png', args: [] };
  }
}

module.exports = { FFMPEG, run, imageOutputArgs };
