// 🌅 Sky Replacement (CC V2): égbolt-csere presetekkel.
//
// Maszk: a MÉLYSÉG-térképből (Depth-Anything) — az ég a legtávolabbi tartomány,
// és a kép felső részén van; ezt a két jelet szorozzuk össze, így a távoli, de
// alul lévő tárgyak (pl. tó) nem kerülnek bele. Nincs külön szegmentáló modell.
//
// Égboltok: eljárásosan generált gradiensek + felhő-textúra (ffmpeg lavfi) —
// nincs licenc-kérdés, és bármikor bővíthető saját képpel.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKY_DIR = path.join(__dirname, 'assets', 'sky');

/** presetek: gradiens-színek + felhő-jelleg */
const SKY_PRESETS = {
  sunset: { top: '0x2b1055', bottom: '0xff8a3d', clouds: 0.35, label: 'Naplemente' },
  storm: { top: '0x2c3138', bottom: '0x8d99a6', clouds: 0.75, label: 'Vihar' },
  night: { top: '0x03040d', bottom: '0x1b2a4a', clouds: 0.15, label: 'Éjszaka' },
  cinematic: { top: '0x0f2027', bottom: '0x78a5c4', clouds: 0.45, label: 'Filmes' },
};

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs ?? 120000, maxBuffer: 128 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} hiba: ${stderr?.toString().slice(-500) || err.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

function listSkies() {
  return Object.entries(SKY_PRESETS).map(([id, p]) => ({ id, label: p.label }));
}

/** égbolt-kép generálása a kért méretre (preset szerint, cache-elve) */
async function ensureSkyImage(preset, w, h) {
  const spec = SKY_PRESETS[preset];
  if (!spec) {
    throw new Error(`Ismeretlen égbolt-preset: ${preset}`);
  }
  fs.mkdirSync(SKY_DIR, { recursive: true });
  const out = path.join(SKY_DIR, `${preset}_${w}x${h}.png`);
  if (fs.existsSync(out)) {
    return out;
  }
  // gradiens + fraktálzaj-felhők; a felhők a horizont felé sűrűsödnek
  await run('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi', '-i',
    `gradients=s=${w}x${h}:c0=${spec.top}:c1=${spec.bottom}:x0=0:y0=0:x1=0:y1=${h}:d=1`,
    // felhő-textúra: fraktálzaj (a cellauto nem fogad `d`-t, a noise-t igen)
    '-f', 'lavfi', '-i',
    `color=c=gray:s=${w}x${h}:d=1,noise=alls=90:allf=t+u,format=gray`,
    '-filter_complex',
    `[1:v]format=gray,gblur=sigma=${Math.round(h / 40)},eq=contrast=1.6:brightness=0.1,` +
      `format=gbrp[cl];[0:v]format=gbrp[bg];` +
      `[bg][cl]blend=all_mode=screen:all_opacity=${spec.clouds},format=rgb24[out]`,
    '-map', '[out]', '-frames:v', '1', '-y', out,
  ]);
  return out;
}

/**
 * Ég-maszk a mélységképből: távoli ÉS felső → ég. A maszk lágy szélű.
 * @returns {Promise<string>} a maszk PNG útja
 */
async function ensureSkyMask(depthPng, dir, w, h) {
  const out = path.join(dir, 'sky-mask.png');
  if (fs.existsSync(out)) {
    return out;
  }
  // lum kicsi = távoli (a depth-nél közel = világos); a felső-súly a Y-ból jön
  const farExpr = `min(max((70-lum(X,Y))/45,0),1)`;
  const topExpr = `min(max((0.72*H-Y)/(0.30*H),0),1)`;
  await run('ffmpeg', [
    '-v', 'error', '-i', depthPng,
    '-vf',
    `format=gray,geq=lum='255*(${farExpr})*(${topExpr})',gblur=sigma=${Math.round(h / 90)}`,
    '-frames:v', '1', '-y', out,
  ]);
  void w;
  return out;
}

/**
 * Égbolt-csere: a kép + mélységkép + preset → kész kompozit.
 * @returns {Promise<{file: string, cached: boolean}>}
 */
async function replaceSky(imagePath, depthPng, preset, dir, size) {
  const md5 = crypto
    .createHash('md5')
    .update(fs.readFileSync(imagePath))
    .digest('hex')
    .slice(0, 12);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `sky-${preset}-${md5}.png`);
  if (fs.existsSync(out)) {
    return { file: out, cached: true };
  }
  const skyImg = await ensureSkyImage(preset, size.w, size.h);
  const mask = await ensureSkyMask(depthPng, dir, size.w, size.h);
  await run('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-i', skyImg,
    '-i', mask,
    '-filter_complex',
    `[0:v]scale=${size.w}:${size.h},format=gbrp[base];` +
      `[1:v]scale=${size.w}:${size.h},format=gbrp[sky];` +
      // a maszk a mélységkép NATÍV méretén készül — ide is skálázni kell,
      // különben a maskedmerge méret-eltérésre hibázik
      `[2:v]scale=${size.w}:${size.h},format=gray,format=gbrp[m];` +
      `[base][sky][m]maskedmerge,format=rgb24[out]`,
    '-map', '[out]', '-frames:v', '1', '-y', out,
  ]);
  return { file: out, cached: false };
}

module.exports = { listSkies, replaceSky, SKY_PRESETS };
