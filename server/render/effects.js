// 🎛️ Klip-effektek FFmpeg-füzérei + a kliens-tükör geometriai/easing magok (nyírás, Bézier).
// (A server/render.js-ből kiemelve, változatlan tartalommal.)

// Per-típus alap-amount — AZONOS a kliens VIDEO_EFFECTS `defaultAmount`-jával
// (videoEffects.ts). Így a null-amount VÉDELMI ág is preview==render (a klip
// rendesen explicit amountot kap az addEffect-ben, de ha valahol hiányzik, a
// kettő akkor is egyezik). A contract-teszt (src/lib/contract.test.ts) zárolja.
const EFFECT_DEFAULT_AMOUNT = {
  blur: 0.4,
  sharpen: 0.5,
  vignette: 0.5,
  grain: 0.3,
  grayscale: 1,
  sepia: 1,
  invert: 1,
  chromaticAberration: 0.5,
  lightLeak: 0.6,
  motionBlur: 0.5,
  deflicker: 0.5,
  clarity: 0.5,
  dehaze: 0.5,
  pixelate: 0.5,
  posterize: 0.5,
  scanlines: 0.6,
  halftone: 0.5,
};
// 🌅 fényszivárgás gauss-esése a jobb-felső sarokból — AZONOS a kliens `LIGHT_LEAK_L`-jével
const LIGHT_LEAK_L = 'exp(-((X-W)*(X-W)+Y*Y)/(2*(W*0.4)*(W*0.4)))';

// 🎛️ Effekt-lánc (audit §6.5) — egy effekt FFmpeg-filtere. AZONOS a kliens
// src/lib/videoEffects.ts `effectFilterString`-jével (preview/UI == render konzisztencia);
// a kettő külön tesztelt. Vesszőtlen (a filtergraph-ban láncolható).
function effectFilterStr(effect) {
  const dflt = EFFECT_DEFAULT_AMOUNT[effect.type] == null ? 0.5 : EFFECT_DEFAULT_AMOUNT[effect.type];
  const a = Math.max(0, Math.min(1, effect.amount == null ? dflt : effect.amount));
  switch (effect.type) {
    case 'blur':
      return `gblur=sigma=${(a * 20).toFixed(2)}`;
    case 'sharpen':
      return `unsharp=5:5:${(a * 2).toFixed(3)}:5:5:0`;
    case 'vignette':
      return `vignette=a=${(0.1 + a * 1.1).toFixed(3)}`;
    case 'grain':
      return `noise=alls=${Math.round(a * 40)}:allf=t+u`;
    case 'grayscale':
      return `hue=s=0`;
    case 'sepia':
      return `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`;
    case 'invert':
      return `negate`;
    case 'chromaticAberration': {
      const n = Math.round(a * 12);
      return `rgbashift=rh=${n}:bh=${-n}`;
    }
    case 'lightLeak':
      return `format=gbrp,geq=r='min(255,r(X,Y)+${(a * 1.4).toFixed(3)}*255*${LIGHT_LEAK_L})':g='min(255,g(X,Y)+${(a * 0.8).toFixed(3)}*255*${LIGHT_LEAK_L})':b='b(X,Y)'`;
    case 'motionBlur':
      return `tmix=frames=${2 + Math.round(a * 6)}`;
    case 'deflicker':
      return `deflicker=size=${2 + Math.round(a * 8)}:mode=pm`;
    // 🖼️ kép-paritás (imageFilters.oneFilter AZONOS stringjei)
    case 'clarity':
      return `unsharp=lx=13:ly=13:la=${(a * 1.5).toFixed(2)}`;
    case 'dehaze':
      return `eq=contrast=${(1 + a * 0.6).toFixed(3)}:saturation=${(1 + a * 0.4).toFixed(3)}`;
    case 'pixelate': {
      const block = 2 + Math.round(a * 22);
      return `pixelize=w=${block}:h=${block}`;
    }
    case 'posterize': {
      const step = Math.round(8 + a * 120);
      return `lutrgb=r='trunc(val/${step})*${step}':g='trunc(val/${step})*${step}':b='trunc(val/${step})*${step}'`;
    }
    case 'scanlines': {
      const f = `(1-${(a * 0.6).toFixed(3)}*mod(Y,2))`;
      return `format=gbrp,geq=r='r(X,Y)*${f}':g='g(X,Y)*${f}':b='b(X,Y)*${f}'`;
    }
    case 'halftone': {
      const T = 4 + Math.round(a * 10);
      const h = (T / 2).toFixed(1);
      return `format=gray,geq=lum='255*lte((mod(X,${T})-${h})*(mod(X,${T})-${h})+(mod(Y,${T})-${h})*(mod(Y,${T})-${h}),${((T * T) / 4).toFixed(2)}*(lum(X,Y)/255))'`;
    }
    default:
      return '';
  }
}

/** A klip engedélyezett effekt-lánca FFmpeg-füzérként (vezető vesszővel), üres ha nincs. */
function effectChainFx(clip) {
  const parts = (clip.effects || [])
    .filter((e) => e && e.enabled !== false)
    .map(effectFilterStr)
    .filter(Boolean);
  return parts.length ? ',' + parts.join(',') : '';
}

/**
 * 🖼️ Nyírás-matek (skew/shear) — a kliens `src/lib/canvasTransform.ts` `shearPoint`-jával
 * BITRE AZONOS. A render `skewChain`-je ezt használja a sarok-vetítéshez; a contract-teszt
 * (`src/lib/contract.test.ts`) a kliens-oldallal egyezésre köti → preview == export.
 */
function shearPoint(x, y, skewXDeg, skewYDeg) {
  const DEG = Math.PI / 180;
  return { x: x + y * Math.tan(skewXDeg * DEG), y: y + x * Math.tan(skewYDeg * DEG) };
}

/**
 * 🎞️ Köbös-Bézier easing (a kliens `src/lib/keyframes.ts` `bezierEase`-ével BITRE AZONOS
 * felezéses megoldás) — a kulcskocka-expander ezt „süti" finom lineáris al-pontokra.
 */
function bezierEaseNode(cp, p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const [x1, y1, x2, y2] = cp;
  const bx = (u) => {
    const v = 1 - u;
    return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
  };
  const by = (u) => {
    const v = 1 - u;
    return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
  };
  let lo = 0;
  let hi = 1;
  let u = p;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    const x = bx(u);
    if (Math.abs(x - p) < 1e-5) {
      break;
    }
    if (x < p) {
      lo = u;
    } else {
      hi = u;
    }
  }
  return by(u);
}

module.exports = {
  EFFECT_DEFAULT_AMOUNT,
  LIGHT_LEAK_L,
  effectFilterStr,
  effectChainFx,
  shearPoint,
  bezierEaseNode,
};
