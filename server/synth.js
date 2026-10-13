// 🎹 Szintetizátor-render (AUDIOT §5): hangjegyek (MIDI) → generált hang (sine/square/
// triangle/sawtooth + ADSR), egyetlen filter_complex-ben (forrás-generátorok + amix).
// NINCS bemeneti fájl — minden hangot az ffmpeg állít elő. A hangmagasság = midiToFreq(midi).
const { spawn } = require('child_process');

const A4_FREQ = 440;
const A4_MIDI = 69;
const MAX_NOTES = 400; // render-plafon (ne robbanjon a filtergraph)

function midiToFreq(midi) {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** aevalsrc hullám-kifejezés [-1,1], ~0.5 amplitúdóval (fejteret hagyva a keveréshez). */
function waveExpr(wave, f) {
  const w = (2 * Math.PI * f).toFixed(6);
  switch (wave) {
    case 'square':
      return `0.45*sgn(sin(${w}*t))`;
    case 'triangle':
      return `0.5*(2/PI)*asin(sin(${w}*t))`;
    case 'sawtooth':
      return `0.45*(2*(${f.toFixed(6)}*t - floor(0.5 + ${f.toFixed(6)}*t)))`;
    case 'sine':
    default:
      return `0.5*sin(${w}*t)`;
  }
}

/**
 * A hangjegyekből filter_complex-láncok (pure → tesztelhető): hangonként egy forrás-generátor
 * (ADSR-rel, hangerővel, a kezdetre késleltetve), majd a hívó `amix`-eli őket. A `bpm` a
 * beat→mp váltáshoz. @returns { chains:string[], labels:string[], totalSec:number }
 */
function synthNoteChains(notes, opts = {}) {
  const bpm = Number(opts.bpm) > 0 ? Number(opts.bpm) : 120;
  const wave = ['sine', 'square', 'triangle', 'sawtooth'].includes(opts.wave) ? opts.wave : 'sine';
  const spb = 60 / bpm;
  const list = (Array.isArray(notes) ? notes : []).slice(0, MAX_NOTES);
  const chains = [];
  const labels = [];
  let totalSec = 0;
  list.forEach((nt, i) => {
    const midi = Math.max(0, Math.min(127, Math.round(Number(nt.midi))));
    const f = midiToFreq(midi);
    const start = Math.max(0, Number(nt.startBeat) || 0) * spb;
    const dur = Math.max(0.05, (Number(nt.lengthBeats) || 1) * spb);
    const vel = Math.max(0, Math.min(1, (Number(nt.velocity) || 100) / 127));
    const startMs = Math.round(start * 1000);
    // tiszta sine a `sine` szűrővel (legtisztább a frekvencia-méréshez), egyéb hullám aevalsrc-vel
    const src =
      wave === 'sine'
        ? `sine=frequency=${f.toFixed(3)}:duration=${dur.toFixed(3)}:sample_rate=44100`
        : `aevalsrc=exprs='${waveExpr(wave, f)}':s=44100:d=${dur.toFixed(3)}`;
    const atk = Math.min(0.008, dur / 4);
    const rel = Math.min(0.06, dur / 3);
    const relSt = Math.max(0, dur - rel);
    const label = `n${i}`;
    chains.push(
      `${src},afade=t=in:st=0:d=${atk.toFixed(3)},afade=t=out:st=${relSt.toFixed(3)}:d=${rel.toFixed(3)},` +
        `volume=${vel.toFixed(3)},aformat=channel_layouts=stereo,aresample=44100,adelay=${startMs}|${startMs}[${label}]`
    );
    labels.push(label);
    totalSec = Math.max(totalSec, start + dur);
  });
  return { chains, labels, totalSec: Math.round(totalSec * 1000) / 1000 };
}

/** A teljes filter_complex (láncok + amix + biztonsági limiter) → `[aout]`. */
function synthFilterComplex(notes, opts = {}) {
  const { chains, labels, totalSec } = synthNoteChains(notes, opts);
  if (labels.length === 0) {
    return null;
  }
  const mix =
    `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `alimiter=limit=0.95[aout]`;
  return { fc: [...chains, mix].join(';\n'), totalSec };
}

/** Hangjegyek → hang-fájl renderelése (m4a/aac vagy wav a kiterjesztésből). */
function renderSynth(notes, opts, outFile) {
  return new Promise((resolve, reject) => {
    const built = synthFilterComplex(notes, opts);
    if (!built) {
      reject(new Error('Nincs renderelhető hangjegy.'));
      return;
    }
    const codec = outFile.endsWith('.wav') ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
    const args = ['-y', '-filter_complex', built.fc, '-map', '[aout]', ...codec, outFile];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err += d.toString();
    });
    ff.on('close', (code) => {
      if (code === 0) {
        resolve({ file: outFile, durationSec: built.totalSec });
      } else {
        reject(new Error(`synth ffmpeg ${code}: ${err.slice(-400)}`));
      }
    });
    ff.on('error', reject);
  });
}

module.exports = { midiToFreq, waveExpr, synthNoteChains, synthFilterComplex, renderSynth, MAX_NOTES };
