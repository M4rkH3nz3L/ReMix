// 🎛️🔊 Sampler-render (AUDIOT §5): a felhasználó SAJÁT mintáját (one-shot) a step-rács
// lépéseire helyezi — a mintát `asplit`-tel többszörözi, a lépés-időpontokra késlelteti, keveri.
// A step-időzítés a drums.js-sel közös (16-od rács). NEM generál hangot — a feltöltött fájlt szólaltatja.
const { spawn } = require('child_process');
const { stepSec } = require('./drums');

const MAX_HITS = 256;
const STEPS_PER_BAR = 16;

/**
 * A lépés-indexekből filter_complex (pure → tesztelhető): a `[0:a]` mintát `asplit=n`-nel
 * többszörözi, hangonként a lépés-időpontra késlelteti, majd amix + limiter. @returns {fc,totalSec} vagy null.
 */
function samplerFilterComplex(steps, opts = {}) {
  const bpm = Number(opts.bpm) > 0 ? Number(opts.bpm) : 120;
  const bars = Math.max(1, Math.floor(Number(opts.bars) || 1));
  const s = stepSec(bpm);
  const list = (Array.isArray(steps) ? steps : [])
    .map((n) => Math.max(0, Math.round(Number(n))))
    .filter((n) => Number.isFinite(n))
    .slice(0, MAX_HITS);
  if (list.length === 0) {
    return null;
  }
  const n = list.length;
  const splitLabels = list.map((_, i) => `s${i}`);
  const chains = [`[0:a]aformat=channel_layouts=stereo,asplit=${n}${splitLabels.map((l) => `[${l}]`).join('')}`];
  const mixLabels = [];
  list.forEach((step, i) => {
    const ms = Math.round(step * s * 1000);
    chains.push(`[s${i}]adelay=${ms}|${ms}[d${i}]`);
    mixLabels.push(`d${i}`);
  });
  chains.push(
    `${mixLabels.map((l) => `[${l}]`).join('')}amix=inputs=${n}:normalize=0,alimiter=limit=0.95[aout]`
  );
  return { fc: chains.join(';\n'), totalSec: Math.round(bars * STEPS_PER_BAR * s * 1000) / 1000 };
}

/** A minta-fájlból a step-minta hang-fájl renderelése (a teljes rács hosszára vágva). */
function renderSampler(sampleFile, steps, opts, outFile) {
  return new Promise((resolve, reject) => {
    const built = samplerFilterComplex(steps, opts);
    if (!built) {
      reject(new Error('Nincs renderelhető lépés.'));
      return;
    }
    const codec = outFile.endsWith('.wav') ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
    const args = ['-y', '-i', sampleFile, '-filter_complex', built.fc, '-map', '[aout]', '-t', built.totalSec.toFixed(3), ...codec, outFile];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err += d.toString();
    });
    ff.on('close', (code) => {
      code === 0 ? resolve({ file: outFile, durationSec: built.totalSec }) : reject(new Error(`sampler ffmpeg ${code}: ${err.slice(-400)}`));
    });
    ff.on('error', reject);
  });
}

module.exports = { STEPS_PER_BAR, MAX_HITS, samplerFilterComplex, renderSampler };
