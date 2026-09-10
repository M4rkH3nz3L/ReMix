// Alap hangeffekt-csomag generálása FFmpeg-szintézissel (első indításkor).
// A server/music mappába dobott saját fájlok (mp3/m4a/wav) szintén bekerülnek
// a könyvtárba — így a zenei kínálat fájlmásolással bővíthető.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SFX_DIR = path.join(__dirname, 'assets', 'sfx');
const MUSIC_DIR = path.join(__dirname, 'music');

/** id → { name, lavfi } — az aevalsrc-kifejezések egyszerű, de használható SFX-ek */
const SFX_DEFS = [
  {
    id: 'whoosh',
    name: 'Whoosh',
    lavfi: 'anoisesrc=d=0.6:c=pink:a=0.7,afade=t=in:d=0.15,afade=t=out:st=0.25:d=0.35',
  },
  {
    id: 'pop',
    name: 'Pop',
    lavfi: "aevalsrc='sin(2*PI*(400+500*exp(-40*t))*t)*exp(-25*t)':d=0.3:s=44100",
  },
  {
    id: 'ding',
    name: 'Ding',
    lavfi:
      "aevalsrc='0.6*sin(2*PI*1318*t)*exp(-4*t)+0.3*sin(2*PI*2637*t)*exp(-6*t)':d=1:s=44100",
  },
  {
    id: 'riser',
    name: 'Riser',
    lavfi: "aevalsrc='0.5*sin(2*PI*(150+900*t*t)*t)':d=1.5:s=44100,afade=t=in:d=0.5",
  },
  {
    id: 'bassdrop',
    name: 'Bass drop',
    lavfi: "aevalsrc='0.9*sin(2*PI*(140*exp(-2*t)+35)*t)*exp(-1.2*t)':d=1.6:s=44100",
  },
  {
    id: 'kick',
    name: 'Kick',
    lavfi: "aevalsrc='sin(2*PI*(50+180*exp(-35*t))*t)*exp(-9*t)':d=0.5:s=44100",
  },
  {
    id: 'click',
    name: 'Kamera-katt',
    lavfi: 'anoisesrc=d=0.05:c=white:a=0.5,afade=t=out:d=0.04',
  },
  {
    id: 'tada',
    name: 'Tada',
    lavfi:
      "aevalsrc='0.5*sin(2*PI*523*t)*exp(-3*t)+0.5*sin(2*PI*784*t)*exp(-3*max(t-0.15\\,0))':d=1.2:s=44100",
  },
];

function generate(def) {
  return new Promise((resolve) => {
    const out = path.join(SFX_DIR, `${def.id}.m4a`);
    if (fs.existsSync(out)) {
      resolve();
      return;
    }
    execFile(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', def.lavfi, '-c:a', 'aac', '-b:a', '128k', out],
      { timeout: 60 * 1000 },
      (err) => {
        if (err) {
          console.warn(`SFX kihagyva (${def.id}):`, err.message.slice(0, 200));
        }
        resolve();
      }
    );
  });
}

async function ensureSfx() {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  for (const def of SFX_DEFS) {
    await generate(def);
  }
}

function probeDuration(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 30 * 1000 },
      (err, stdout) => {
        resolve(err ? 0 : parseFloat(stdout.trim()) || 0);
      }
    );
  });
}

/** A teljes könyvtár: generált SFX-ek + a music mappa saját fájljai. */
async function listLibrary() {
  const items = [];
  for (const def of SFX_DEFS) {
    const file = path.join(SFX_DIR, `${def.id}.m4a`);
    if (fs.existsSync(file)) {
      items.push({
        id: `sfx-${def.id}`,
        name: def.name,
        kind: 'sfx',
        file,
        duration: await probeDuration(file),
      });
    }
  }
  const musicFiles = fs.existsSync(MUSIC_DIR)
    ? fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f))
    : [];
  for (const f of musicFiles) {
    const file = path.join(MUSIC_DIR, f);
    items.push({
      id: `music-${f}`,
      name: f.replace(/\.[^.]+$/, ''),
      kind: 'music',
      file,
      duration: await probeDuration(file),
    });
  }
  return items;
}

module.exports = { ensureSfx, listLibrary };
