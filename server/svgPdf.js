// 📄 SVG → nyomdakész (vektor) PDF — a kliens `imageDocToSvg` kimenetét a worker
// Chromiumjával PDF-be nyomtatjuk (`page.pdf`). Így a vektor-dokumentum VEKTORKÉNT
// exportálódik PDF-be (nem raszter-kép), a fotó-rétegek a kliensnél base64 data-URI-ba
// ágyazva utaznak az SVG-ben → ÖNÁLLÓ, megosztható PDF. A text/forma ugyanúgy renderel,
// mint a text-render.js (azonos Chromium) → PDF-parity a PNG-exporttal.
const { chromium } = require('playwright-core');
const path = require('path');
const { findChromium } = require('./text-render');

/**
 * 🛡️ I44: a kliens „SVG"-je felhasználói bemenet. Csak egyetlen `<svg>…</svg>` gyökér
 * mehet tovább (a HTML-környezetből nem törhet ki), szkript / eseménykezelő /
 * külső-entitás nélkül. A valódi gát a böngésző-szint (JS ki, hálózat tiltva) — ez a
 * mélységi védelem, és a hibás bemenetet érthető 400-zal utasítja vissza.
 */
function sanitizeSvg(raw) {
  let svg = String(raw || '').replace(/^\uFEFF/, '').trim();
  svg = svg.replace(/^<\?xml[\s\S]*?\?>\s*/i, '');
  if (/<!ENTITY/i.test(svg)) {
    return null;
  }
  svg = svg.replace(/^<!DOCTYPE[^>]*>\s*/i, '').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) {
    return null;
  }
  return svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/** Minden hálózati kérést tilt: csak a lap saját tartalma és a beágyazott `data:` mehet. */
async function blockNetwork(context) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url === 'about:blank') {
      return route.continue();
    }
    return route.abort();
  });
}

/**
 * Egy (önálló) SVG-string → PDF a megadott vászon-méretben (pont = px, nincs margó,
 * a háttér megtartva). Visszaadja a PDF fájl útvonalát a `workDir`-ben.
 */
async function renderSvgToPdf(rawSvg, { width, height, workDir }) {
  const svg = sanitizeSvg(rawSvg);
  if (!svg) {
    const err = new Error('Hibás vagy nem támogatott SVG.');
    err.status = 400;
    throw err;
  }
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs elérhető Chromium a PDF-rendereléshez (CHROMIUM_PATH?)');
  }
  const W = Math.max(1, Math.min(10000, Math.round(width || 1080)));
  const H = Math.max(1, Math.min(10000, Math.round(height || 1080)));
  const browser = await chromium.launch({ executablePath });
  try {
    // 🛡️ I44: JS-mentes kontextus, tiltott hálózat (SSRF: belső címek, metaadat-végpontok)
    const context = await browser.newContext({ javaScriptEnabled: false });
    await blockNetwork(context);
    const page = await context.newPage();
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

module.exports = { renderSvgToPdf, sanitizeSvg };
