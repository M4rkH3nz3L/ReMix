const { logCaught } = require('../lib/caught');
// 🎚️ Kétmenetes hang-mesterelés (loudnorm-mérés + alkalmazás). (A server/render.js-ből kiemelve.)
const { execFile } = require('child_process');
const path = require('path');

const { masterGraph, masterLra } = require('../voicechain');
const { runFfmpegWithProgress } = require('./ffmpeg');
const { audioEncoderArgs, safeSampleRate } = require('./presets');

// 🎚️ MASTER 1. menet: a master-gráf (EQ+multiband) + loudnorm MÉRÉS (JSON a
// stderr-en) → a mért Integrated/TP/LRA/thresh/offset.
function measureLoudnorm(inFile, graphStr, I, TP, LRA, signal) {
  return new Promise((resolve, reject) => {
    const fc = `${graphStr};[mst]loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json[a]`;
    execFile(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', inFile, '-filter_complex', fc, '-map', '[a]', '-f', 'null', '-'],
      { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) },
      (_e, _o, stderr) => {
        if (signal && signal.aborted) {
          reject(new Error('render megszakítva'));
          return;
        }
        const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(stderr || '');
        if (!m) {
          reject(new Error('loudnorm mérés sikertelen'));
          return;
        }
        try {
          resolve(JSON.parse(m[0]));
        } catch (caught) {
          logCaught('render.js:measureLoudnorm', caught);
          reject(new Error('a mérés-JSON olvashatatlan'));
        }
      }
    );
  });
}

// 🎚️ MASTER 2. menet: EQ+multiband + loudnorm a MÉRT értékekkel (linear=true →
// PONTOS cél-LUFS + true-peak plafon). Videónál a kép változatlan (-c:v copy).
//
// ⚠️ NINCS külön alimiter a loudnorm UTÁN: a live-teszt kimutatta, hogy a záró
// limiter +1 LU-t adott (a csúcs-limitálás megemeli az integrált hangosságot). A
// `loudnorm` maga true-peak-limitál a `TP`-re (linear mód clip esetén dinamikusra
// vált), így a záró limiter redundáns volt ÉS rontotta a LUFS-pontosságot.
// Mérés (48 kHz sztereó pink, cél −14): kimenet −14.00 LUFS · −2.25 dBTP.
/**
 * A master második menete. Hangexportnál a köztes fájl hang-only lebegőpontos PCM, így a
 * mesterelés nem kódol veszteségesen; videónál a hang a beállított minőséggel kódolódik.
 */
async function applyMaster(inFile, master, workDir, total, onProgress, { audioOnly = false, settings = {}, signal } = {}) {
  const I = master.lufs;
  const TP = master.truePeak;
  const LRA = masterLra(master.dynamics);
  const graphStr = masterGraph(master, 'mst');
  const m = await measureLoudnorm(inFile, graphStr, I, TP, LRA, signal);
  const fc =
    `${graphStr};[mst]loudnorm=I=${I}:TP=${TP}:LRA=${LRA}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,` +
    // a loudnorm belül 192 kHz-re mintavételez; vissza a mix rátájára (különben 96/192 kHz-es export)
    `aresample=${safeSampleRate(settings) || 44100}[a]`;
  const out = path.join(workDir, `mastered${path.extname(inFile)}`);
  const streams = audioOnly
    ? ['-map', '[a]', '-c:a', 'pcm_f32le']
    : ['-map', '[a]', '-map', '0:v', '-c:v', 'copy', ...audioEncoderArgs(settings)];
  await runFfmpegWithProgress(['-y', '-i', inFile, '-filter_complex', fc, ...streams, out], total, onProgress, signal);
  return out;
}

module.exports = {
  measureLoudnorm,
  applyMaster,
};
