// Szövegklipek rasterizálása átlátszó PNG-vé headless Chromiummal.
// A CSS ugyanazokat a stílus-preseteket valósítja meg, mint az app TextOverlay-e,
// így a beégetett felirat vizuálisan egyezik az előnézettel.
//
// Egy klip több PNG-állapotot kaphat: a typewriter a szöveg prefixeit, a
// karaoke a szó-kiemelés fázisait rendereli; a render.js enable-ablakokkal
// váltja őket. A többi animáció (fade/slide/pop/pulse/shake) egyetlen PNG-t
// kap, a mozgás/alpha az FFmpeg-oldalon fut.
//
// A modulcsalád a server/textRender/ alatt: chromium (böngésző-felkutatás), fontFaces
// (@font-face), textCss (stílus-CSS), textStates (animációs állapotok), textHtml (3D /
// görbe menti szöveg), renderText (szöveg-raszter + bake), shapeSvg / shapePattern
// (forma-primitívek), renderShape (forma-raszter).
const { findChromium } = require('./textRender/chromium');
const { customFace, fontFaceCss, fontFamilyCss } = require('./textRender/fontFaces');
const { typographyCss, textStyleCss, presetCss, textTransformCss } = require('./textRender/textCss');
const { renderTextPngs, bakeTextPng } = require('./textRender/renderText');
const { pathDataJs } = require('./textRender/shapeSvg');
const { patternTileJs, shapePatternSvgDefJs, isRenderableShapePatternJs } = require('./textRender/shapePattern');
const { renderShapePngs } = require('./textRender/renderShape');

module.exports = {
  // 🧪 teszthez: a saját font @font-face-e (null = elutasítva)
  __fontCss: customFace,
  textTransformCss,
  renderTextPngs,
  renderShapePngs,
  bakeTextPng,
  pathDataJs,
  // a kinetic (per-frame) szöveg-szekvencia UGYANEZEKET a helpereket használja
  findChromium,
  fontFaceCss,
  fontFamilyCss,
  typographyCss,
  textStyleCss,
  presetCss,
  // 🧩 forma-minta (a kliens src/lib/shapePattern.ts tükre — contract-tesztelt)
  patternTileJs,
  shapePatternSvgDefJs,
  isRenderableShapePatternJs,
};
