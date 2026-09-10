// 🎨 Color AI (P1, v1): kép/videó-kocka szín-statisztikái — az Auto Color és a
// Match Color alapja. Determinisztikus mérés (nem modell): a kliens pure
// leképezője fordítja a meglévő ClipAdjust-ra (fényerő/kontraszt/szaturáció/
// hőmérséklet), amit az előnézet és a render már ismer.
const { execFile } = require('child_process');

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

module.exports = { colorStats };
