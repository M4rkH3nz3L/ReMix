// YouTube (és bármely yt-dlp által támogatott URL) import a dev-workeren:
// teljes VIDEÓ, csak HANG (m4a), vagy egy KÉP (képkocka a megadott mp-nél).
// A yt-dlp külső függőség (mint a whisper/ollama) — `brew install yt-dlp`,
// vagy a bináris a YTDLP_BIN env-ben. Tartalom-hash-kulcsú lemez-cache.
const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const YT_DIR = path.join(os.tmpdir(), 'vided-youtube');

function ytBin() {
  return process.env.YTDLP_BIN || 'yt-dlp';
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs ?? 180000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd}: ${(stderr || err.message).toString().slice(0, 400)}`));
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

let _avail = null;
/** Elérhető-e a yt-dlp a workeren? (első híváskor ellenőriz, utána cache-el) */
function ytAvailable() {
  if (_avail !== null) {
    return _avail;
  }
  try {
    execFileSync(ytBin(), ['--version'], { timeout: 5000, stdio: 'ignore' });
    _avail = true;
  } catch {
    _avail = false;
  }
  return _avail;
}

async function probeDuration(file) {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 15000);
    return Math.round(parseFloat(out.trim()) * 1000) / 1000 || 0;
  } catch {
    return 0;
  }
}

async function probeDims(file) {
  try {
    const out = await run(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
      15000
    );
    const [w, h] = out.trim().split('x').map((n) => parseInt(n, 10));
    return { width: w || undefined, height: h || undefined };
  } catch {
    return {};
  }
}

/** Egy stream (v/a) kodek-neve — az iOS-kompatibilitás ellenőrzéséhez. */
async function probeCodec(file, streamType) {
  try {
    const out = await run(
      'ffprobe',
      ['-v', 'error', '-select_streams', `${streamType}:0`, '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file],
      15000
    );
    return out.trim();
  } catch {
    return '';
  }
}

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
}

/**
 * Import egy URL-ből. kind: 'video' | 'audio' | 'image'. atSec: a képkocka
 * ideje (image esetén, mp). Visszaad: { id, name, kind, duration?, width?, height? }.
 * A fájl a GET /youtube/:id/:name-en tölthető le. 720p-re korlátozva (mobil).
 */
async function importMedia(url, kind, atSec) {
  if (!ytAvailable()) {
    throw new Error('A yt-dlp nincs telepítve a workeren (brew install yt-dlp).');
  }
  if (!isHttpUrl(url)) {
    throw new Error('Érvénytelen URL.');
  }
  const k = ['video', 'audio', 'image'].includes(kind) ? kind : 'video';
  const at = Math.max(0, Number(atSec) || 0);
  const key = crypto.createHash('md5').update(`${url.trim()}|${k}|${k === 'image' ? at : ''}`).digest('hex').slice(0, 16);
  const dir = path.join(YT_DIR, key);
  fs.mkdirSync(dir, { recursive: true });

  const done = (name, extra) => ({ id: key, name, kind: k, ...extra });

  if (k === 'video') {
    const out = path.join(dir, 'video.mp4');
    if (!fs.existsSync(out)) {
      const raw = path.join(dir, 'raw.mp4');
      // iOS-kompatibilis kodek preferálása: H.264 (avc1) videó + AAC (mp4a) hang.
      // A modern YouTube alapból VP9/AV1 + Opus streamet ad, amit az iOS
      // AVPlayer/expo-video NEM tud dekódolni → letöltődne, de nem játszódna le.
      await run(ytBin(), [
        '--no-playlist', '--no-warnings',
        '-f',
        'bestvideo[vcodec^=avc1][height<=720]+bestaudio[acodec^=mp4a]/' +
          'best[vcodec^=avc1][height<=720]/best[ext=mp4][height<=720]/best',
        '-S', 'vcodec:h264,acodec:aac,res:720',
        '--merge-output-format', 'mp4', '-o', raw, url.trim(),
      ]);
      // biztosítjuk a H.264/AAC-ot: ha a forrás mégsem az (nincs avc1 stream),
      // átkódoljuk — így a videó GARANTÁLTAN lejátszható iOS-en is
      const [vcodec, acodec] = await Promise.all([probeCodec(raw, 'v'), probeCodec(raw, 'a')]);
      if (vcodec === 'h264' && (acodec === 'aac' || acodec === '')) {
        fs.renameSync(raw, out);
      } else {
        await run(
          'ffmpeg',
          ['-y', '-i', raw, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out],
          300000
        );
        fs.rmSync(raw, { force: true });
      }
    }
    const [duration, dims] = await Promise.all([probeDuration(out), probeDims(out)]);
    return done('video.mp4', { duration, ...dims });
  }

  if (k === 'audio') {
    const out = path.join(dir, 'audio.m4a');
    if (!fs.existsSync(out)) {
      await run(ytBin(), [
        '--no-playlist', '--no-warnings', '-x', '--audio-format', 'm4a',
        '-o', path.join(dir, 'audio.%(ext)s'), url.trim(),
      ]);
    }
    const duration = await probeDuration(out);
    return done('audio.m4a', { duration });
  }

  // image: egy képkocka a megadott mp-nél (közvetlen stream-URL + ffmpeg -ss),
  // yt-dlp -g-vel (nem tölti le a teljes videót); hiba esetén a poszter-thumbnail
  const out = path.join(dir, 'frame.jpg');
  if (!fs.existsSync(out)) {
    let grabbed = false;
    try {
      const urls = (await run(ytBin(), [
        '--no-playlist', '--no-warnings', '-f', 'best[height<=720]/best', '-g', url.trim(),
      ], 30000)).trim().split('\n').filter(Boolean);
      if (urls[0]) {
        await run('ffmpeg', ['-y', '-ss', String(at), '-i', urls[0], '-frames:v', '1', '-q:v', '3', out], 60000);
        grabbed = fs.existsSync(out);
      }
    } catch {
      grabbed = false;
    }
    if (!grabbed) {
      // fallback: a videó poszter-képe
      await run(ytBin(), [
        '--no-playlist', '--no-warnings', '--skip-download', '--write-thumbnail',
        '--convert-thumbnails', 'jpg', '-o', path.join(dir, 'frame'), url.trim(),
      ]);
      const thumb = path.join(dir, 'frame.jpg');
      if (!fs.existsSync(thumb)) {
        throw new Error('Nem sikerült képet kinyerni az URL-ből.');
      }
    }
  }
  const dims = await probeDims(out);
  return done('frame.jpg', dims);
}

function youtubeFile(id, name) {
  if (!/^[a-f0-9]{8,32}$/i.test(id) || !/^[a-z0-9._-]+$/i.test(name)) {
    return null;
  }
  return path.join(YT_DIR, id, name);
}

module.exports = { ytAvailable, importMedia, youtubeFile, YT_DIR };
