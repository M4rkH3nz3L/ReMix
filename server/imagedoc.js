// 🎨 Kép-dokumentum rasterizáló (Creative Canvas V1): réteg-fa → PNG.
//
// ELV: a formákat és a feliratokat UGYANAZOK a generátorok rajzolják, mint az
// idővonalon (text-render.js) — nem külön HTML-lel, mert két külön generátor
// előbb-utóbb szétcsúszna, és a képben mást látnál, mint a videóban. A rétegek
// külön PNG-be mennek, majd ffmpeg-gel, RAJZOLÁSI SORRENDBEN egymásra
// komponálódnak; a fotó-rétegek skálázása/vágása is itt történik.
//
// REFACTOR: a megvalósítás a server/imagedocLib/ alatt, felelősség szerint bontva — remoteMedia (távoli
// média), ffmpeg (futtatás + kimeneti formátum), develop (RAW-develop tükör), canvas (vászon-méret), layers
// (réteg-segédek), guard (nagy-doc korlát), renderDoc (kompozit). Ez a homlokzat ugyanazt a module.exports-ot
// adja (kulcsok, sorrend, függvény-identitások).
const { resolveRemoteMedia } = require('./imagedocLib/remoteMedia');
const { imageOutputArgs } = require('./imagedocLib/ffmpeg');
const { developFilterPlan, developChain, isNeutralDevelop } = require('./imagedocLib/develop');
const { docCanvas, canvasSize } = require('./imagedocLib/canvas');
const { MAX_LAYERS, MAX_TOTAL_POINTS, imageDocGuard } = require('./imagedocLib/guard');
const { renderImageDoc } = require('./imagedocLib/renderDoc');

module.exports = {
  renderImageDoc,
  resolveRemoteMedia,
  docCanvas,
  canvasSize,
  imageOutputArgs,
  imageDocGuard,
  MAX_LAYERS,
  MAX_TOTAL_POINTS,
  // 📸 RAW-develop tükör (contract-lock a src/lib/photoDevelop.ts-szel)
  developFilterPlan,
  developChain,
  isNeutralDevelop,
};
