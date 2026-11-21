// 🖼️ Kép-eszközök — PDF oldal-szám (pdf-lib) és oldal → PNG raszter (pdfjs-dist + @napi-rs/canvas), lustán betöltve.
/**
 * 📄 A PDF oldal-számának PURE kiolvasása (pdf-lib) — a kvóta-gate ELŐTT, a költséges
 * rasterizálás NÉLKÜL. Olvashatatlan PDF → beszédes hiba (a `parsePdfToImageDocs`
 * `readPdfStructure`-je úgyis ugyanazt dobja; itt csak az oldal-szám kell előre).
 */
async function probePdfPageCount(buf) {
  const { PDFDocument } = require('pdf-lib');
  let pdf;
  try {
    pdf = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw new Error(`A PDF-fájl nem olvasható: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
  }
  const pageCount = pdf.getPageCount();
  if (pageCount < 1) {
    throw new Error('A PDF-ben nincs oldal.');
  }
  return { pageCount };
}

/**
 * 📄 pdfjs-munkamenet nyitása a rasterizáláshoz (legacy node-build, worker NÉLKÜL).
 * A `pdfjs-dist/legacy/build/pdf.mjs` ESM → dinamikus `import()` (lusta, csak akkor
 * húzzuk be, ha tényleg rasterizálunk). A `@napi-rs/canvas` (prebuilt) adja a 2D-
 * kontextust. Ha bármelyik hiányzik a workeren → beszédes hiba (a /pdf/import 400-zal
 * jelzi; a MAG + a struktúra akkor is kész + tesztelt, ez a prod-raszter TODO-felülete).
 */
async function openPdfForRaster(buf) {
  let pdfjs;
  let napiCanvas;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    napiCanvas = require('@napi-rs/canvas');
  } catch (err) {
    throw new Error(
      `A PDF-rasterizáló nincs telepítve a workeren (pdfjs-dist / @napi-rs/canvas): ${String(err && err.message ? err.message : err).slice(0, 120)}`
    );
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  return { pdf, napiCanvas };
}

/** 📄 egy PDF-oldal (0-alapú index) PNG-buffer a kívánt px-méretre (pdfjs + canvas). */
async function rasterPdfPage(session, pageIndex, size) {
  const page = await session.pdf.getPage(pageIndex + 1); // pdfjs 1-alapú
  // a kívánt px-szélesség/az oldal pt-szélessége = a render-skála (a mag px-mérete mérvadó)
  const base = page.getViewport({ scale: 1 });
  const scale = base.width > 0 ? size.w / base.width : 1;
  const viewport = page.getViewport({ scale });
  const canvas = session.napiCanvas.createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
  const ctx = canvas.getContext('2d');
  // fehér háttér (a PDF-oldal átlátszó területei ne legyenek feketék a PNG-ben)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toBuffer('image/png');
}

module.exports = { probePdfPageCount, openPdfForRaster, rasterPdfPage };
