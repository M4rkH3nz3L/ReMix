// 🎨 Kép-dokumentum — a vászon pixel-mérete (arány + magasság, vagy a doc szabad W×H-ja).
/** a vászon mérete az arányból (a rövidebb oldal a megadott felbontás) */
function canvasSize(aspectRatio, height) {
  const [aw, ah] = String(aspectRatio || '9:16')
    .split(':')
    .map((v) => Number(v) || 1);
  const H = Math.round(height / 2) * 2;
  const W = Math.round((H * aw) / ah / 2) * 2;
  return { w: W, h: H };
}

/** páros px-re kerekített, [16, 4096] közé zárt méret (a kép-editor szabad W×H-ja) */
const MAX_CANVAS = 4096;

function evenClamp(n) {
  return Math.round(Math.max(16, Math.min(MAX_CANVAS, Number(n) || 0)) / 2) * 2;
}

/** a vászon mérete: ha a doc EXPLICIT width×height-ot hordoz, AZ a mérvadó
 *  (szabad méret, kép-editor); különben a régi arány+magasság út. */
function docCanvas(doc, height) {
  if (doc.width && doc.height) {
    // 📐 I9: a kért kimeneti magasság skáláz (2× export); I10: a plafon aránytartó
    const requested = Number(height) > 0 ? Number(height) / doc.height : 1;
    const scale = Math.min(requested, MAX_CANVAS / Math.max(doc.width, doc.height));
    return { w: evenClamp(doc.width * scale), h: evenClamp(doc.height * scale) };
  }
  return canvasSize(doc.aspectRatio, height);
}

module.exports = { canvasSize, MAX_CANVAS, evenClamp, docCanvas };
