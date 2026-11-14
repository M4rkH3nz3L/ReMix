'use strict';

/**
 * 🗣️ AUDIO-PROD V7.3 — formáns-megőrző hangmagasság a szerveres renderben. Az ffmpeg-lánc a hangmagasságot
 * asetrate+atempo-val tolja (a formánsok is tolódnak). Ha a klipen `audioFx.formant` be van kapcsolva, a
 * render ELŐTT a klip ablakát két változatban kirendereljük (tolatlanul = referencia, tolva), a kettőt a
 * kliensével bitre azonos `formantCorrect` (server/lib/formant.js) egyezteti, és a lánc a kész fájlból indul
 * (a vágás, megfordítás, sebesség és hangmagasság már benne van). A kliens sorrendje: nyújtás + hangmagasság
 * → korrekció → a többi effekt.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { formantCorrect } = require('./lib/formant');
const { pitchFilters } = require('./voicechain');

const SR = 44100;

function ffmpegToF32(input, filter, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-af', filter, '-ac', '2', '-ar', String(SR), '-f', 'f32le', outPath];
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`formant ffmpeg ${code}: ${err.slice(-300)}`))));
  });
}

function readStereo(file) {
  const buf = fs.readFileSync(file);
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = f.length >> 1;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = f[i * 2];
    r[i] = f[i * 2 + 1];
  }
  return [l, r];
}

/** 32 bites lebegőpontos sztereó WAV */
function writeWavF32(file, l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(l[i], 44 + i * 8);
    buf.writeFloatLE(r[i], 48 + i * 8);
  }
  fs.writeFileSync(file, buf);
}

/** kell-e formáns-előkészítés ehhez a klipen (és a megadott teljes eltoláshoz) */
function needsFormantPrep(clip, semitones) {
  return !!clip.audioFx?.formant && Math.round(semitones || 0) !== 0 && !(clip.loopLength > 0);
}

/**
 * A klip ablakának formáns-korrigált, eltolt változata egy WAV-ba. `windowFilter` = a vágás/megfordítás/
 * sebesség szűrői vesszővel lezárva (a render ugyanazt használja, mint a normál úton). Visszaad: a fájl útja.
 */
async function prepareFormantClip({ uri, windowFilter, semitones, duration, workDir, key }) {
  const base = path.join(workDir, `formant_${String(key).replace(/[^a-z0-9_-]/gi, '_')}`);
  const tail = `aresample=${SR},apad,atrim=end=${duration.toFixed(6)},asetpts=PTS-STARTPTS`;
  await ffmpegToF32(uri, `${windowFilter}aresample=${SR},${tail}`, `${base}_ref.raw`);
  await ffmpegToF32(uri, `${windowFilter}${pitchFilters(semitones).join(',')},${tail}`, `${base}_sh.raw`);
  const [rl, rr] = readStereo(`${base}_ref.raw`);
  const [sl, sr] = readStereo(`${base}_sh.raw`);
  const out = `${base}.wav`;
  writeWavF32(out, formantCorrect(rl, sl, SR), formantCorrect(rr, sr, SR));
  fs.rmSync(`${base}_ref.raw`, { force: true });
  fs.rmSync(`${base}_sh.raw`, { force: true });
  return out;
}

module.exports = { needsFormantPrep, prepareFormantClip, writeWavF32, readStereo };
