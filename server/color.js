// 🎨 Color AI (P1, v1): kép/videó-kocka szín-statisztikái — az Auto Color és a
// Match Color alapja. Determinisztikus mérés (nem modell): a kliens pure
// leképezője fordítja a meglévő ClipAdjust-ra (fényerő/kontraszt/szaturáció/
// hőmérséklet), amit az előnézet és a render már ismer.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZE = 128; // a statisztikához bőven elég, gyors

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 60000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} hiba: ${stderr?.toString().slice(-400) || err.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

/**
 * Egy kocka szín-statisztikái a fájl atSec pontjáról (0–1 skálán):
 * luma-átlag és -percentilisek (kontraszthoz), csatorna-átlagok (színhő),
 * szaturáció-átlag.
 */
async function colorStats(file, atSec = 0) {
  // -ss csak pozitív időre: állóképen a 0-s bemeneti seek az EGYETLEN kockát
  // is eldobná ("Output file is empty")
  const seek = atSec > 0.001 ? ['-ss', String(atSec)] : [];
  const rgb = await run('ffmpeg', [
    '-v', 'error',
    ...seek,
    '-i', file,
    '-vf', `scale=${SIZE}:${SIZE}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
  const px = Math.floor(rgb.length / 3);
  if (px < SIZE * SIZE * 0.5) {
    throw new Error('Nem sikerült képkockát olvasni.');
  }
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let satSum = 0;
  let skinPx = 0;
  const lumaHist = new Uint32Array(256);
  for (let i = 0; i < px; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    satSum += max > 0 ? (max - min) / max : 0;
    // 🧑 bőrtónus-arány: a klasszikus RGB-küszöb (Kovac és tsai) — nem
    // arcdetektálás, csak azt méri, a képnek mekkora része esik a bőrtónus-
    // tartományba. Ez elég ahhoz, hogy a portrékon visszafogjuk a szín-
    // korrekciót (a bőr a legérzékenyebb a hő- és telítettség-tolásra).
    if (
      r > 95 && g > 40 && b > 20 &&
      max - min > 15 &&
      Math.abs(r - g) > 15 &&
      r > g && r > b
    ) {
      skinPx++;
    }
    lumaHist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
  }
  const percentile = (p) => {
    const target = px * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += lumaHist[v];
      if (acc >= target) {
        return v / 255;
      }
    }
    return 1;
  };
  let lumaSum = 0;
  for (let v = 0; v < 256; v++) {
    lumaSum += v * lumaHist[v];
  }
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    lumaMean: round(lumaSum / px / 255),
    lumaP5: round(percentile(0.05)),
    lumaP95: round(percentile(0.95)),
    satMean: round(satSum / px),
    rMean: round(rSum / px / 255),
    gMean: round(gSum / px / 255),
    bMean: round(bSum / px / 255),
    skinRatio: round(skinPx / px),
  };
}

/**
 * 🎨 Színpipetta: a fájl atSec kockájának pixel-színe a (x,y) vászon-normalizált
 * ponton (0–1). A forrás-kockát SIZE×SIZE-ra skálázzuk (mint a statoknál), a
 * normalizált pontról 1 px-t vágunk ki → hex. Green screen manuális kulcsolásához.
 */
async function pixelColor(file, atSec = 0, x = 0.5, y = 0.5) {
  const seek = atSec > 0.001 ? ['-ss', String(atSec)] : [];
  const cx = Math.round(Math.min(1, Math.max(0, x)) * (SIZE - 1));
  const cy = Math.round(Math.min(1, Math.max(0, y)) * (SIZE - 1));
  const rgb = await run('ffmpeg', [
    '-v', 'error',
    ...seek,
    '-i', file,
    '-vf', `scale=${SIZE}:${SIZE},crop=1:1:${cx}:${cy}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
  if (rgb.length < 3) {
    throw new Error('Nem sikerült pixelt olvasni.');
  }
  const hex = '#' + [rgb[0], rgb[1], rgb[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { color: hex };
}

// 🩻 Videoszkópok: az egyes típusok ffmpeg-szűrő-láncai (fix méretű PNG-t adnak).
// A `null` display/format-lezárás nélkül a szűrők yuv-bemenetet várnak, ezért
// előbb a megfelelő pixelformátumra konvertálunk, a végén rgb24-re a PNG-hez.
const SCOPES = {
  // luma-hullámforma (átlátszó overlay, tükrözve)
  waveform:
    'format=yuv420p,waveform=intensity=0.15:mirror=1:components=1:display=overlay,scale=320:256',
  // RGB parade: a három csatorna hullámformája egymás mellett
  parade:
    'format=yuv444p,waveform=intensity=0.15:components=7:mode=column:display=parade,scale=360:256',
  // vektorszkóp (szín-eloszlás színkerékben, graticule-lel)
  vectorscope: 'format=yuv444p,vectorscope=mode=color3:graticule=green:flags=name,scale=256:256',
  // hisztogram (R/G/B egymásra rakva)
  histogram: 'histogram=display_mode=stack,scale=320:256',
};

/**
 * 🩻 Videoszkóp-kép a fájl atSec kockájáról a kért típussal (waveform / parade /
 * vectorscope / histogram) → base64 PNG. Determinisztikus mérőeszköz (nem
 * modell) — a kliens overlay-ként mutatja a lejátszófejnél.
 */
async function scopeImage(file, atSec = 0, type = 'waveform') {
  const chain = SCOPES[type] || SCOPES.waveform;
  const seek = atSec > 0.001 ? ['-ss', String(atSec)] : [];
  const png = await run('ffmpeg', [
    '-v', 'error',
    ...seek,
    '-i', file,
    '-vf', `${chain},format=rgb24`,
    '-frames:v', '1',
    '-c:v', 'png',
    '-f', 'image2pipe',
    'pipe:1',
  ]);
  if (!png || png.length < 100) {
    throw new Error('Nem sikerült szkóp-képet készíteni.');
  }
  return { pngBase64: png.toString('base64'), type };
}

/**
 * 🎞️ LUT-EXPORT: a klip aktuális grade-je (preset + kézi adjust + curves + HSL +
 * esetleg importált LUT) → .cube 3D LUT szöveg. Egy IDENTITÁS-rácsot (S³ szín,
 * .cube-sorrend: R gyorsan, majd G, majd B) 1×N képként átfuttatunk a grade
 * lánc PER-PIXEL szűrőin (a vignettát KIHAGYJUK — az pozíciófüggő, nem szín-
 * transzformáció), majd a visszaolvasott pixelekből írjuk a .cube-ot.
 */
async function exportLut(clip, size = 33) {
  const { gradeChain } = require('./render');
  const S = Math.max(2, Math.min(64, Math.round(size) || 33));
  const N = S * S * S;
  const grid = Buffer.alloc(N * 3);
  let i = 0;
  for (let b = 0; b < S; b++) {
    for (let g = 0; g < S; g++) {
      for (let r = 0; r < S; r++) {
        grid[i++] = Math.round((r / (S - 1)) * 255);
        grid[i++] = Math.round((g / (S - 1)) * 255);
        grid[i++] = Math.round((b / (S - 1)) * 255);
      }
    }
  }
  // vignetta ki; importált LUT csak ha a fájl elérhető a workeren
  const adjust = { ...(clip.adjust || {}), vignette: 0 };
  if (adjust.lut && !(adjust.lut.uri && fs.existsSync(String(adjust.lut.uri)))) {
    delete adjust.lut;
  }
  const chain = gradeChain({ ...clip, adjust }).replace(/^,/, '');
  const vf = chain ? `format=rgb24,${chain},format=rgb24` : 'format=rgb24';

  const inFile = path.join(os.tmpdir(), `lutgrid_${process.pid}_${N}.rgb`);
  fs.writeFileSync(inFile, grid);
  let out;
  try {
    out = await run('ffmpeg', [
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${N}x1`, '-i', inFile,
      '-vf', vf,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ]);
  } finally {
    try { fs.unlinkSync(inFile); } catch { /* ignore */ }
  }
  const lines = ['# ReMix color grade export', `LUT_3D_SIZE ${S}`, ''];
  for (let k = 0; k < N; k++) {
    const r = (out[k * 3] / 255).toFixed(6);
    const g = (out[k * 3 + 1] / 255).toFixed(6);
    const b = (out[k * 3 + 2] / 255).toFixed(6);
    lines.push(`${r} ${g} ${b}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { colorStats, pixelColor, exportLut, scopeImage };
