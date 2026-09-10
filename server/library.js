// Általános média-tár (full-plan F2, a StorageProvider szerver-oldala): a
// server/library mappába másolt videó/kép/hang fájlokat szolgálja ki az app
// „Tár" paneljének. A videó/hang hosszát ffprobe adja (név+mtime cache-sel),
// a kínálat fájlmásolással bővíthető — ~30 mp-en belül megjelenik az appban.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, 'library');

const KIND_BY_EXT = {
  '.mp4': 'video',
  '.mov': 'video',
  '.m4v': 'video',
  '.webm': 'video',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.heic': 'image',
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.wav': 'audio',
  '.aac': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
};

const durationCache = new Map(); // `${name}|${mtimeMs}` → mp

function probeDuration(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 30 * 1000 },
      (err, stdout) => {
        resolve(err ? 0 : parseFloat(stdout) || 0);
      }
    );
  });
}

async function listMediaLibrary() {
  fs.mkdirSync(LIB_DIR, { recursive: true });
  const names = fs.readdirSync(LIB_DIR).filter((n) => !n.startsWith('.'));
  const items = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    const kind = KIND_BY_EXT[ext];
    if (!kind) {
      continue;
    }
    const file = path.join(LIB_DIR, name);
    const stat = fs.statSync(file);
    let duration = 0;
    if (kind !== 'image') {
      const key = `${name}|${stat.mtimeMs}`;
      if (!durationCache.has(key)) {
        durationCache.set(key, await probeDuration(file));
      }
      duration = durationCache.get(key);
    }
    items.push({
      id: name,
      name: path.basename(name, ext),
      kind,
      duration: Math.round(duration * 10) / 10,
      size: stat.size,
      file,
    });
  }
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

module.exports = { listMediaLibrary, LIB_DIR };
