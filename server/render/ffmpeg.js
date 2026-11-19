const { logCaught } = require('../lib/caught');
// ffmpeg / ffprobe futtatása: egyszerű hívás, hang-stream vizsgálat, szűrő-elérhetőség (cache),
// és a render fő menete előrehaladás-jelentéssel. (A server/render.js-ből kiemelve.)
const { execFile, spawn } = require('child_process');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs ?? 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} hiba: ${stderr?.slice(-2000) || err.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function hasAudioStream(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      file,
    ]);
    return stdout.trim().length > 0;
  } catch (caught) {
    logCaught('render.js:hasAudioStream', caught);
    return false;
  }
}

/** a forrás hang-csatornáinak száma (0 = nincs hangsáv) */
async function audioChannelCount(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file]);
    return Number(stdout.trim()) || 0;
  } catch (caught) {
    logCaught('render.js:audioChannelCount', caught);
    return 0;
  }
}

const _filterCache = new Map();
/** van-e az ffmpeg-ben a megadott szűrő (pl. zscale) — egyszer lekérdezve, cache-elve */
function ffmpegHasFilter(name) {
  if (!_filterCache.has(name)) {
    let ok = false;
    try {
      const out = require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-filters'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      ok = new RegExp(`\\s${name}\\s`).test(out);
    } catch (caught) {
      logCaught('render.js:ffmpegHasFilter', caught);
      ok = false;
    }
    _filterCache.set(name, ok);
  }
  return _filterCache.get(name);
}

/**
 * ffmpeg futtatása előrehaladás-jelentéssel: a -progress kimenet out_time_us
 * sora (mikroszekundum) osztva a teljes hosszal adja a 0-1 arányt.
 */
function runFfmpegWithProgress(args, totalSeconds, onProgress, signal) {
  return new Promise((resolve, reject) => {
    // 🛑 megszakítás-tudatos: ha a hívó (kliens ✕) már abortált, el se indítjuk
    if (signal && signal.aborted) {
      reject(new Error('render megszakítva'));
      return;
    }
    // a -progress globális opció — a kimeneti fájl elé kell, különben az
    // ffmpeg második kimenetként értelmezné a pipe:1-et
    const child = spawn('ffmpeg', ['-progress', 'pipe:1', '-nostats', ...args], {
      timeout: 10 * 60 * 1000,
    });
    // 🛑 abort → az ffmpeg-processt AZONNAL megállítjuk (ne pazaroljon CPU-t/lemezt)
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch (caught) {
        logCaught('render.js:onAbort', caught);
        /* a process már leállt */
      }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const unbind = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    let stderrTail = '';
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/) ?? line.match(/^out_time_ms=(\d+)/);
        if (m && totalSeconds > 0 && onProgress) {
          const seconds = parseInt(m[1], 10) / 1e6;
          onProgress(Math.max(0, Math.min(1, seconds / totalSeconds)));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      unbind();
      reject(new Error(`ffmpeg hiba: ${err.message}`));
    });
    child.on('close', (code) => {
      unbind();
      if (signal && signal.aborted) {
        reject(new Error('render megszakítva'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg hiba: ${stderrTail}`));
      }
    });
  });
}

module.exports = {
  run,
  hasAudioStream,
  audioChannelCount,
  ffmpegHasFilter,
  runFfmpegWithProgress,
};
