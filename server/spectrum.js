// 📊 Spektrogram-render (AUDIOT §7): egy hang-fájlból frekvencia-kép (showspectrumpic) — a
// creator LÁTJA a mix frekvencia-egyensúlyát (EQ-döntésekhez). NEM módosít hangot, csak elemez.
const { spawn } = require('child_process');

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/** A showspectrumpic filter-string (pure → tesztelhető). */
function spectrumFilter(opts = {}) {
  const w = clampN(Number(opts.width) || 720, 160, 1920);
  const h = clampN(Number(opts.height) || 360, 120, 1080);
  const mode = opts.mode === 'separate' ? 'separate' : 'combined';
  return `showspectrumpic=s=${w}x${h}:mode=${mode}:color=intensity:scale=log:legend=1`;
}

/** Hang-fájl → spektrogram PNG. */
function renderSpectrum(inFile, opts, outFile) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inFile, '-lavfi', spectrumFilter(opts), '-frames:v', '1', outFile];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err += d.toString();
    });
    ff.on('close', (code) => {
      code === 0 ? resolve({ file: outFile }) : reject(new Error(`spectrum ffmpeg ${code}: ${err.slice(-400)}`));
    });
    ff.on('error', reject);
  });
}

module.exports = { spectrumFilter, renderSpectrum };
