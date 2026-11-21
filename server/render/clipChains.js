// 🧩 Klip-geometria és kompozit-láncok (dőlés, nyírás, perspektíva, chroma, maszk, megjelenés,
// kulcskocka-mozgás, 2.5D parallax, transzform). A renderProject zárványából kiemelve: a láncok a
// render-környezetet (W, H, FPS, graph, addInput) a `createClipChains(rc)` paraméterén át kapják.
//
// REFACTOR: homlokzat — a láncok a render/clipChainsLib/ alatt (geometria / maszk / megjelenés / mozgás), mind
// ugyanazt az `rc`-t kapja; a visszaadott objektum ugyanazokkal a kulcsokkal, ugyanabban a sorrendben.
const { createGeometryChains } = require('./clipChainsLib/geometry');
const { createMaskChains } = require('./clipChainsLib/maskChains');
const { createAppearanceChains } = require('./clipChainsLib/appearance');
const { createMotionChains } = require('./clipChainsLib/motionChains');

/**
 * @param rc a render-környezet: { W, H, FPS, graph, addInput } (a renderProject-ből)
 */
function createClipChains(rc) {
  const geo = createGeometryChains(rc);
  const mask = createMaskChains(rc);
  const look = createAppearanceChains(rc);
  const motion = createMotionChains(rc, geo);

  return {
    hasTilt: geo.hasTilt,
    hasPersp: geo.hasPersp,
    perspChain: geo.perspChain,
    hasTransform: geo.hasTransform,
    TILT_PAD: geo.TILT_PAD,
    tiltChain: geo.tiltChain,
    hasSkew: geo.hasSkew,
    skewPad: geo.skewPad,
    skewChain: geo.skewChain,
    chromaChain: look.chromaChain,
    polyWExpr: mask.polyWExpr,
    staticPoly: mask.staticPoly,
    withMask: mask.withMask,
    appearanceChain: look.appearanceChain,
    blurBackgroundChain: look.blurBackgroundChain,
    hasKf: motion.hasKf,
    withKeyframeMotion: motion.withKeyframeMotion,
    withDepthParallax: motion.withDepthParallax,
    withTransform: motion.withTransform,
  };
}

module.exports = { createClipChains };
