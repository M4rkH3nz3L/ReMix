// 🌀 Idő-/mozgás-láncok: mozgás-elmosás / sima lassítás, stabilizálás, fade (a videoFilters.js-ből).
const { FPS } = require('../constants');

/**
 * 🌀 Mozgás-elmosás / sima lassítás (speed ramp v2) — a `fps=` lépést váltja ki.
 * Gyorsításnál a decimálás ELŐTT keveri a kockákat (tmix), így épp azokat mossa
 * össze, amiket a képkocka-ritkítás eldobna. Lassításnál a minterpolate köztes
 * kockákat számol a lépcsőzés helyett; ez CPU-igényes, ezért rövid darabokra
 * korlátozzuk. Erő nélkül a régi, egyszerű fps-lánc megy.
 */
function motionChain(clip, dur) {
  const strength = Math.max(0, Math.min(1, clip.motionBlur ?? 0));
  const plain = `fps=${FPS},`;
  const fast = clip.speed > 1.05;
  const slow = clip.speed < 0.95;
  const speedupBlend = () => {
    // a sebességgel arányos keverési ablak (2× → ~4 kocka, 6×-nál a 8-as plafon)
    const frames = Math.max(2, Math.min(8, Math.round(1 + Math.max(strength, 0.5) * clip.speed * 1.6)));
    return `tmix=frames=${frames},${plain}`;
  };
  // ⏱️ explicit idő-interpoláció (time remapping) — felülírja a motionBlur-autót
  const interp = clip.timeInterp;
  if (interp && interp !== 'none') {
    if (slow && dur <= 12) {
      return interp === 'flow'
        ? `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,`
        : `minterpolate=fps=${FPS}:mi_mode=blend,`; // képkocka-keverés
    }
    if (fast) {
      return speedupBlend();
    }
    return plain;
  }
  // vissza a motionBlur-alapú viselkedésre (kompatibilitás)
  if (strength <= 0) {
    return plain;
  }
  if (fast) {
    return speedupBlend();
  }
  if (slow && dur <= 8) {
    return `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,`;
  }
  return plain;
}

/**
 * 🎯 Videó-stabilizálás (`deshake`, egymenetes). A `strength` a keresési
 * tartományt (rx/ry, 16 többszöröse), a `smoothness` a blokkméretet, a `crop`
 * a szélek eltüntetéséhez befelé kivágást ad (a downstream fit-scale nagyítja
 * vissza). RS: finomabb blokk + clamp él. Vezető filter-lánc (a nyers kockára,
 * a méretezés ELŐTT); vesszővel zár, hogy a `decode`-hoz fűzhető legyen.
 */
function stabilizeChain(clip) {
  const s = clip.stabilize;
  if (!s || !s.automatic) {
    return '';
  }
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  const strength = cl(s.strength ?? 0.5, 0, 1);
  const rx = 16 * Math.min(4, Math.max(1, Math.round(1 + strength * 3))); // 16…64 (16 többszöröse)
  const smoothness = cl(s.smoothness ?? 0.5, 0, 1);
  let blocksize = Math.round(8 + smoothness * 40); // 8…48
  const crop = cl(s.crop ?? 0, 0, 1);
  const edge = s.rollingShutter ? 2 : 3; // rs → clamp; egyébként mirror
  if (s.rollingShutter) {
    blocksize = Math.max(8, Math.round(blocksize * 0.6)); // finomabb becslés
  }
  let chain = `deshake=rx=${rx}:ry=${rx}:edge=${edge}:blocksize=${blocksize}`;
  if (crop > 0.01) {
    // a képet befelé kivágjuk (középre); a szélek bemozduló sávja eltűnik, a
    // downstream méretezés nagyítja vissza a vászonra
    const z = (1 - crop * 0.15).toFixed(3);
    chain += `,crop=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2`;
  }
  return chain + ',';
}

function fadeFilters(clip, visDur) {
  let s = '';
  const fi = clip.fadeInSec ?? 0;
  const fo = clip.fadeOutSec ?? 0;
  if (fi > 0) {
    s += `,fade=t=in:st=0:d=${Math.min(fi, visDur).toFixed(3)}`;
  }
  if (fo > 0) {
    const d = Math.min(fo, visDur);
    s += `,fade=t=out:st=${(visDur - d).toFixed(3)}:d=${d.toFixed(3)}`;
  }
  return s;
}

module.exports = { motionChain, stabilizeChain, fadeFilters };
