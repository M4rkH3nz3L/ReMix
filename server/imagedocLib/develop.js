const { adjustChain } = require('../render');

// 📸 RAW-develop (S-PHOTO — PIXEL 01): a KLIENS `developToFilterPlan` TÜKRE. A
// non-destruktív fotó-előhívás egyetlen forrás-igazsága a deklaratív lépés-lista
// ({param, value}[]) — a kliens preview és a worker render UGYANEBBŐL dolgozik,
// a `src/lib/contract.test.ts` `toEqual`-lal zárolja a két fn-t (egyoldali drift = piros).
//
// base-mezők (ClipAdjust): a renderben a MEGLÉVŐ `adjustChain`-re esnek vissza
// (exposure/contrast/highlights/… bitre a sima korrekcióval azonos); a detail-
// mezők (clarity/texture/dehaze/sharpness/noiseReduction/CA/torzítás) ffmpeg-
// szűrőkre képződnek (a videoEffects clarity/dehaze/chromaticAberration AZONOS
// stringjeivel, ahol van megfelelő).
const DEVELOP_BASE_TONE = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'];
const DEVELOP_BASE_COLOR = ['temperature', 'tint', 'saturation', 'vibrance', 'hue', 'hslSaturation', 'hslLuminance'];
const DEVELOP_DETAIL_MID = ['clarity', 'texture', 'dehaze', 'sharpness', 'noiseReduction'];
const DEVELOP_DETAIL_LENS = ['chromaticAberration', 'lensDistortion'];

/** a `src/lib/photoDevelop.ts` `developToFilterPlan`-jének BITRE AZONOS tükre (contract-lock). */
function developFilterPlan(dev) {
  if (!dev) {
    return [];
  }
  const base = dev.base || {};
  const detail = dev.detail || {};
  const steps = [];
  const pushBase = (key) => {
    const v = base[key];
    if (typeof v === 'number' && v !== 0) {
      steps.push({ param: key, value: v });
    }
  };
  const pushDetail = (key) => {
    const v = detail[key];
    if (typeof v === 'number' && v !== 0) {
      steps.push({ param: key, value: v });
    }
  };
  DEVELOP_BASE_TONE.forEach(pushBase);
  DEVELOP_BASE_COLOR.forEach(pushBase);
  DEVELOP_DETAIL_MID.forEach(pushDetail);
  pushBase('vignette');
  DEVELOP_DETAIL_LENS.forEach(pushDetail);
  return steps;
}

/** igaz, ha az előhívás semmit sem változtat (a kliens `isNeutralDevelop` render-oldali párja). */
function isNeutralDevelop(dev) {
  if (!dev) {
    return true;
  }
  if (developFilterPlan(dev).length > 0) {
    return false;
  }
  const base = dev.base || {};
  return !base.curves && !base.balance && !base.lut && !base.gradientMap && !base.splitTone;
}

/** egy RAW-detail lépés ffmpeg-szűrője (vesszőtlen). A clarity/dehaze/CA a
 *  videoEffects AZONOS stringjei; a többi közeli ffmpeg-megfelelő. */
function developDetailFilter(param, value) {
  const a = Math.max(-1, Math.min(1, Number(value) || 0));
  switch (param) {
    case 'clarity': {
      // középtónus-kontraszt: nagy-sugarú unsharp (a videoEffects `clarity`-vel azonos skála)
      return `unsharp=lx=13:ly=13:la=${(a * 1.5).toFixed(2)}`;
    }
    case 'texture': {
      // finom textúra: kis-sugarú unsharp (lokális mikro-kontraszt)
      return `unsharp=lx=5:ly=5:la=${(a * 1.2).toFixed(2)}`;
    }
    case 'dehaze': {
      // pára-eltávolítás: kontraszt+telítettség emelés (a videoEffects `dehaze`-zel azonos)
      return `eq=contrast=${(1 + a * 0.6).toFixed(3)}:saturation=${(1 + a * 0.4).toFixed(3)}`;
    }
    case 'sharpness': {
      // élesítés (0…1): finom luma-unsharp
      return `unsharp=5:5:${(a * 2).toFixed(3)}:5:5:0`;
    }
    case 'noiseReduction': {
      // zajcsökkentés (0…1): nem-lokális átlagolás (nlmeans) növekvő erővel
      return `nlmeans=s=${(1 + a * 9).toFixed(2)}`;
    }
    case 'chromaticAberration': {
      // CA-korrekció: a videoEffects `chromaticAberration`-jével AZONOS rgbashift
      const n = Math.round(a * 12);
      return `rgbashift=rh=${n}:bh=${-n}`;
    }
    case 'lensDistortion': {
      // lencse-torzítás: barrel(+) ↔ pincushion(−) korrekció (lenscorrection k1/k2)
      const k = (a * 0.3).toFixed(4);
      return `lenscorrection=k1=${k}:k2=${k}`;
    }
    default:
      return '';
  }
}

/**
 * A fotó-réteg develop-láncának VEZETŐ-VESSZŐS ffmpeg-füzére (mint az `adjustChain`).
 * A base-mezőket a MEGLÉVŐ `adjustChain`-re delegálja (paritás), a detail-mezőket
 * a `developFilterPlan` sorrendjében fűzi. Üres, ha hiányzó/neutrális.
 */
function developChain(dev) {
  if (isNeutralDevelop(dev)) {
    return '';
  }
  // base: a ClipAdjust-mezők a meglévő korrekció-lánccal (exposure/contrast/… + görbe/3-way/lut/…)
  const baseChain = adjustChain({ adjust: dev.base });
  // detail: a plan detail-lépései (a base-lépéseket a baseChain már lefedte)
  const detailParts = [];
  for (const step of developFilterPlan(dev)) {
    if (DEVELOP_DETAIL_MID.includes(step.param) || DEVELOP_DETAIL_LENS.includes(step.param)) {
      const f = developDetailFilter(step.param, step.value);
      if (f) {
        detailParts.push(f);
      }
    }
  }
  const detailChain = detailParts.length ? ',' + detailParts.join(',') : '';
  return baseChain + detailChain;
}

module.exports = {
  DEVELOP_BASE_TONE,
  DEVELOP_BASE_COLOR,
  DEVELOP_DETAIL_MID,
  DEVELOP_DETAIL_LENS,
  developFilterPlan,
  isNeutralDevelop,
  developDetailFilter,
  developChain,
};
