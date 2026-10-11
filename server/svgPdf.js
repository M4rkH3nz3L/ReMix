// 📄 SVG → nyomdakész (vektor) PDF — a kliens `imageDocToSvg` kimenetét a worker
// Chromiumjával PDF-be nyomtatjuk (`page.pdf`). Így a vektor-dokumentum VEKTORKÉNT
// exportálódik PDF-be (nem raszter-kép), a fotó-rétegek a kliensnél base64 data-URI-ba
// ágyazva utaznak az SVG-ben → ÖNÁLLÓ, megosztható PDF. A text/forma ugyanúgy renderel,
// mint a text-render.js (azonos Chromium) → PDF-parity a PNG-exporttal.
const { chromium } = require('playwright-core');
const path = require('path');
const { findChromium } = require('./text-render');

/**
 * Egy (önálló) SVG-string → PDF a megadott vászon-méretben (pont = px, nincs margó,
 * a háttér megtartva). Visszaadja a PDF fájl útvonalát a `workDir`-ben.
 */
async function renderSvgToPdf(svg, { width, height, workDir }) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs elérhető Chromium a PDF-rendereléshez (CHROMIUM_PATH?)');
  }
  const W = Math.max(1, Math.min(10000, Math.round(width || 1080)));
  const H = Math.max(1, Math.min(10000, Math.round(height || 1080)));
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    // a lap PONTOSAN a vászon mérete legyen → a PDF egyetlen, margó nélküli oldal
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>` +
        `*{margin:0;padding:0}html,body{width:${W}px;height:${H}px}` +
        `svg{display:block;width:${W}px;height:${H}px}</style></head>` +
        `<body>${svg}</body></html>`,
      { waitUntil: 'load' }
    );
    const out = path.join(workDir, 'imagedoc.pdf');
    await page.pdf({
      path: out,
      width: `${W}px`,
      height: `${H}px`,
      printBackground: true,
      pageRanges: '1',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return out;
  } finally {
    await browser.close();
  }
}

module.exports = { renderSvgToPdf };
