// 🎞️ Kulcskocka → ffmpeg-időkifejezés (a renderProject zárványából kiemelve: tiszta, a render-
// beállítástól független függvények — a videó-, szöveg- és hang-láncok közösen használják).
const { bezierEaseNode } = require('./effects');

// --- Kulcskockák (P0-5): a kliens src/lib/keyframes.ts görbéivel megegyező
// ffmpeg-időkifejezések. P = klippelt progressz, easing az induló kulcskockáé.
const easedProgress = (P, easing) => {
  switch (easing) {
    case 'easeIn':
      return `pow(${P},2)`;
    case 'easeOut':
      return `(1-pow(1-${P},2))`;
    case 'easeInOut':
      return `(${P}*${P}*(3-2*${P}))`;
    case 'hold':
      return '0'; // 🅷 step: az érték a szegmensben áll (a.value), majd a köv. kulcskockán ugrik
    default:
      return P;
  }
};

// 🎞️ Köbös-Bézier easing (a kliens src/lib/keyframes.ts bezierEase-ével AZONOS
// felezéses megoldás) — az FFmpeg nem tud zárt alakban Bézier-időt visszafejteni,
// ezért a bezier-szegmenst finom LINEÁRIS al-kulcskockákra „sütjük", és a
// kész if-lánc ugyanazt a görbét reprodukálja (preview↔render paritás).
// a bezier-easing a KÖZÖS top-level `bezierEaseNode` (== kliens bezierEase; contract-teszt köti)
const BEZIER_STEPS = 16;
const expandBezier = (kfs) => {
  if (!kfs || kfs.length < 2 || !kfs.some((k) => k.easing === 'bezier' && Array.isArray(k.bezier))) {
    return kfs;
  }
  const out = [];
  for (let i = 0; i < kfs.length; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (b && a.easing === 'bezier' && Array.isArray(a.bezier)) {
      // a szegmens kezdő-pontja + BEZIER_STEPS-1 köztes lineáris al-pont
      out.push({ time: a.time, value: a.value, easing: 'linear' });
      for (let s = 1; s < BEZIER_STEPS; s++) {
        const p = s / BEZIER_STEPS;
        out.push({
          time: a.time + p * (b.time - a.time),
          value: a.value + (b.value - a.value) * bezierEaseNode(a.bezier, p),
          easing: 'linear',
        });
      }
    } else {
      out.push(a);
    }
  }
  return out;
};

/** kulcskocka-csatorna → darabonkénti if-lánc a T időkifejezésre */
const kfChannelExpr = (rawKfs, fallback, T) => {
  const kfs = expandBezier(rawKfs); // bezier → finom lineáris LUT (paritás)
  if (!kfs || kfs.length === 0) {
    return Number(fallback).toFixed(5);
  }
  const n = (v) => Number(v).toFixed(5);
  let expr = n(kfs[kfs.length - 1].value); // utolsó után tartva
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const span = Math.max(b.time - a.time, 0.001);
    const P = `min(max((${T}-${n(a.time)})/${n(span)},0),1)`;
    const seg = `(${n(a.value)}+${n(b.value - a.value)}*${easedProgress(P, a.easing)})`;
    expr = `if(lt(${T},${n(b.time)}),${seg},${expr})`;
  }
  return `if(lt(${T},${n(kfs[0].time)}),${n(kfs[0].value)},${expr})`; // első előtt tartva
};

module.exports = {
  easedProgress,
  BEZIER_STEPS,
  expandBezier,
  kfChannelExpr,
};
