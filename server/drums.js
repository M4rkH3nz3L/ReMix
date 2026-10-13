// 🥁 Dob-gép-render (AUDIOT §5): SZINTETIZÁLT dob-hangok (kick/snare/hihat/clap) — nincs
// minta-fájl-függés. Minden ütés egy ffmpeg forrás-generátor, a lépés-időpontra késleltetve,
// egyetlen filter_complex-ben amix-elve. A lépés-időzítés: 16-od, lépés = (60/bpm)/4 mp.
const { spawn } = require('child_process');

const STEPS_PER_BAR = 16;
const MAX_HITS = 512; // render-plafon
const VOICES = ['kick', 'snare', 'hihat', 'clap'];

/** Egy dob-hang ffmpeg forrás-lánca (önálló, saját hosszal + lecsengéssel). */
function voiceSource(voice) {
  switch (voice) {
    case 'kick':
      // lecsengő mély sine, gyors pitch-dropdal → ütős kick
      return `aevalsrc=exprs='exp(-t*18)*sin(2*PI*(55+90*exp(-t*30))*t)':d=0.30:s=44100`;
    case 'snare':
      // fehér zaj test + sávszűrés, gyors lecsengés
      return `anoisesrc=d=0.20:a=0.7:c=white,highpass=f=1500,lowpass=f=8000,afade=t=out:st=0.005:d=0.19`;
    case 'hihat':
      // magas, nagyon rövid zaj-burst
      return `anoisesrc=d=0.06:a=0.5:c=white,highpass=f=8000,afade=t=out:st=0:d=0.06`;
    case 'clap':
      // közép-sávú zaj-burst
      return `anoisesrc=d=0.13:a=0.6:c=white,bandpass=f=1200:width_type=h:w=1200,afade=t=out:st=0.01:d=0.12`;
    default:
      return null;
  }
}

/** lépés hossza mp-ben (16-od). */
function stepSec(bpm) {
  return 60 / (bpm > 0 ? bpm : 120) / 4;
}

/**
 * Ütésekből (voice+step) filter_complex-láncok (pure → tesztelhető): hangonként egy
 * forrás-generátor, hangerővel, a lépés-időpontra késleltetve. @returns {chains, labels, totalSec}
 */
function drumHitChains(hits, opts = {}) {
  const bpm = Number(opts.bpm) > 0 ? Number(opts.bpm) : 120;
  const bars = Math.max(1, Math.floor(Number(opts.bars) || 1));
  const sStep = stepSec(bpm);
  const list = (Array.isArray(hits) ? hits : []).slice(0, MAX_HITS);
  const chains = [];
  const labels = [];
  list.forEach((h, i) => {
    const src = voiceSource(h.voice);
    if (!src || !Number.isFinite(Number(h.step))) {
      return;
    }
    const vel = Math.max(0, Math.min(1, Number(h.velocity) > 0 ? Number(h.velocity) / 127 : 0.9));
    const startMs = Math.round(Math.max(0, Number(h.step)) * sStep * 1000);
    const label = `d${i}`;
    chains.push(
      `${src},volume=${vel.toFixed(3)},aformat=channel_layouts=stereo,aresample=44100,adelay=${startMs}|${startMs}[${label}]`
    );
    labels.push(label);
  });
  return { chains, labels, totalSec: Math.round(bars * STEPS_PER_BAR * sStep * 1000) / 1000 };
}

/** Teljes filter_complex (láncok + amix + limiter) → `[aout]`. */
function drumFilterComplex(hits, opts = {}) {
  const { chains, labels, totalSec } = drumHitChains(hits, opts);
  if (labels.length === 0) {
    return null;
  }
  const mix =
    `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `alimiter=limit=0.95[aout]`;
  return { fc: [...chains, mix].join(';\n'), totalSec };
}

/** Ütések → dob-minta hang-fájl. */
function renderDrums(hits, opts, outFile) {
  return new Promise((resolve, reject) => {
    const built = drumFilterComplex(hits, opts);
    if (!built) {
      reject(new Error('Nincs renderelhető dob-ütés.'));
      return;
    }
    const codec = outFile.endsWith('.wav') ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
    // a teljes rács hosszára vágunk (hogy a minta loop-olható, fix hosszú legyen)
    const args = ['-y', '-filter_complex', built.fc, '-map', '[aout]', '-t', built.totalSec.toFixed(3), ...codec, outFile];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err += d.toString();
    });
    ff.on('close', (code) => {
      code === 0 ? resolve({ file: outFile, durationSec: built.totalSec }) : reject(new Error(`drums ffmpeg ${code}: ${err.slice(-400)}`));
    });
    ff.on('error', reject);
  });
}

module.exports = { VOICES, STEPS_PER_BAR, stepSec, voiceSource, drumHitChains, drumFilterComplex, renderDrums, MAX_HITS };
