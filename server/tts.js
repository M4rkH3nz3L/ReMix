// TTS (szöveg → beszéd) a dev-workeren: macOS `say` → AAC/m4a (ffmpeg).
// A faceless/AI-creatoroknak: voiceover felvétel nélkül. Provider-független
// minta (mint az ai.js/whisper): dev-ben `say`, élesben cloud-TTS-re cserélhető.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TTS_DIR = path.join(os.tmpdir(), 'vided-tts');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs ?? 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd}: ${(stderr || err.message).toString().slice(0, 300)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** A TTS csak macOS dev-workeren érhető el (`say`). */
function ttsAvailable() {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/say');
}

async function probeDuration(file) {
  try {
    const out = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ]);
    return Math.round(parseFloat(out.toString().trim()) * 1000) / 1000 || 0;
  } catch {
    return 0;
  }
}

/**
 * Szöveg → m4a. Tartalom-hash-kulcsú lemez-cache (szöveg+hang egyszer generál).
 * Visszaad: { id, name, duration }. A fájl a GET /tts/:id/:name-en tölthető le.
 */
async function synthesize(text, voice) {
  const clean = (text || '').toString().slice(0, 2000).trim();
  if (!clean) {
    throw new Error('Nincs szöveg.');
  }
  const key = crypto.createHash('md5').update(`${voice || ''}|${clean}`).digest('hex').slice(0, 16);
  const dir = path.join(TTS_DIR, key);
  const m4a = path.join(dir, 'voice.m4a');
  if (!fs.existsSync(m4a)) {
    fs.mkdirSync(dir, { recursive: true });
    const aiff = path.join(dir, 'v.aiff');
    const sayArgs = ['-o', aiff];
    if (voice) {
      sayArgs.push('-v', voice);
    }
    sayArgs.push(clean);
    await run('say', sayArgs);
    await run('ffmpeg', ['-y', '-i', aiff, '-c:a', 'aac', '-b:a', '128k', m4a]);
    try {
      fs.unlinkSync(aiff);
    } catch {
      /* nem fatális */
    }
  }
  return { id: key, name: 'voice.m4a', duration: await probeDuration(m4a) };
}

function ttsFile(id, name) {
  // path-traversal védelem: csak a TTS_DIR alatti fájlok
  const safe = path.join(TTS_DIR, path.basename(id), path.basename(name));
  return safe;
}

/** Elérhető hangok (`say -v ?`) — {name, locale} lista. */
function listVoices() {
  return new Promise((resolve) => {
    if (!ttsAvailable()) {
      resolve([]);
      return;
    }
    execFile('say', ['-v', '?'], { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const voices = stdout
        .toString()
        .split('\n')
        .map((line) => {
          const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/);
          return m ? { name: m[1].trim(), locale: m[2] } : null;
        })
        .filter(Boolean);
      resolve(voices);
    });
  });
}

module.exports = { ttsAvailable, synthesize, ttsFile, listVoices, TTS_DIR };
