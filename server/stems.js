// 🎚️ Stem-szeparáció (AI audio, Phase D) — a hangot komponensekre (vocals / drums
// / bass / other) bontja a Demucs-csal. NEHÉZ AI → külön menet, binár-kapuzva
// (mint a RevenueCat/OAuth): Demucs nélkül a végpont beszédes hibát ad, nem omlik
// össze. A stemek ÚJ hangklipek lesznek (non-destruktív), nem felülírás.
//
// Env: STEMS_ENABLED=1 (be), DEMUCS_BIN (alap: 'demucs'), DEMUCS_MODEL (alap:
// 'htdemucs'). A modell letöltése/mérete deploy-függőség (első futáskor tölti).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEMUCS_BIN = process.env.DEMUCS_BIN || 'demucs';
const DEMUCS_MODEL = process.env.DEMUCS_MODEL || 'htdemucs';
const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'];

/** Be van-e kapcsolva a stem-szeparáció (van-e Demucs-környezet). */
function stemsConfigured() {
  return process.env.STEMS_ENABLED === '1' || !!process.env.DEMUCS_BIN;
}

/**
 * Egy hangfájl szétbontása stemekre. Visszaadja a kész WAV-ok elérési útját
 * `[{ name, path }]` alakban. A Demucs a `<outDir>/<model>/<alap>/<stem>.wav`
 * struktúrába ír.
 */
function separateStems(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    execFile(
      DEMUCS_BIN,
      ['-n', DEMUCS_MODEL, '--out', outDir, inputPath],
      { timeout: 20 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
      (err) => {
        if (err) {
          reject(new Error(`Demucs hiba: ${err.message}`));
          return;
        }
        const base = path.basename(inputPath, path.extname(inputPath));
        const dir = path.join(outDir, DEMUCS_MODEL, base);
        const stems = STEM_NAMES.map((name) => ({ name, path: path.join(dir, `${name}.wav`) })).filter(
          (s) => fs.existsSync(s.path)
        );
        if (stems.length === 0) {
          reject(new Error('A Demucs nem adott stemeket.'));
          return;
        }
        resolve(stems);
      }
    );
  });
}

module.exports = { stemsConfigured, separateStems, STEM_NAMES };
