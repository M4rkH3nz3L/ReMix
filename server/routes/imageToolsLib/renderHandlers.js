const { logCaught } = require('../../lib/caught');
// 🖼️ Kép-eszközök — raszter (/imagedoc) és vektor-PDF (/svg/pdf) render-handlerek.
// A handlerek SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/imageTools.js-ben.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { INSECURE_DEV } = require('../../auth');
const { shouldWatermark } = require('../../entitlements');
const { asTier } = require('../../tiers');
const { activeTier } = require('../../billing');
const { renderImageDoc, resolveRemoteMedia, imageDocGuard } = require('../../imagedoc');
const { renderSvgToPdf } = require('../../svgPdf');
const { bindUploadedMedia } = require('../../lib/bindMedia');
const { remoteMediaOpts } = require('./remoteMediaOpts');

/**
 * 🎨 Kép-dokumentum rasterizálása: réteg-fa (JSON) + a hivatkozott médiafájlok
 * → PNG. A formákat/feliratokat ugyanaz a generátor rajzolja, mint az
 * idővonalon, így a kép és a videó megjelenése garantáltan egyezik.
 */
exports.imageDocHandler = (req, res) => {
  let doc;
  let uriMap;
  try {
    doc = JSON.parse(req.body.doc);
    uriMap = JSON.parse(req.body.uriMap ?? '{}');
  } catch (caught) {
    logCaught('routes/imageTools.js', caught);
    res.status(400).json({ error: 'Hibás doc/uriMap JSON.' });
    return;
  }
  // 🛡️ nagy-doc gát: inkább beszédes hiba, mint néma elakadás a workeren
  const guardError = imageDocGuard(doc);
  if (guardError) {
    res.status(413).json({ error: guardError });
    return;
  }
  bindUploadedMedia(doc, req.files, uriMap);
  const height = Math.max(240, Math.min(4096, Number(req.body.height) || 1280));
  const format = req.body.format; // png (alap) | jpg | webp
  const quality = req.body.quality != null ? Number(req.body.quality) : undefined;
  // ha a doc-hoz nem jött feltöltött média (tisztán vektor/forma/szöveg kép —
  // logó, gradient-poszter, felirat), a multer `destination`-je nem futott → nincs
  // req.workDir; itt pótoljuk, hogy a fotó NÉLKÜLI doc is renderelhető legyen.
  if (!req.workDir) {
    req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  }
  // a válasz (kép) teljes elküldése UTÁN takarítjuk a temp-mappát (eddig szivárgott)
  res.on('finish', () => fs.rm(req.workDir, { recursive: true, force: true }, () => {}));
  // 🏷️ free-vízjel a SZERVER-HITELES tier szerint (a kliens NEM kapcsolhatja ki):
  // prod-ban a user előfizetéséből (activeTier), dev-ben a kért tier-ből.
  const tierPromise = INSECURE_DEV ? Promise.resolve(asTier(req.body.tier)) : activeTier(req.user?.id);
  const missing = [];
  tierPromise
    .then(async (tier) => {
      await resolveRemoteMedia(doc, req.workDir, remoteMediaOpts(req));
      return renderImageDoc(doc, height, req.workDir, {
        format,
        quality,
        watermark: shouldWatermark(tier),
        onMissing: (id) => missing.push(id),
      });
    })
    .then((file) => {
      // ⚠️ I3: a kimaradt rétegek száma a válaszban — a kliens megmondja a usernek
      if (missing.length > 0) {
        res.set('X-Missing-Layers', String(missing.length));
      }
      res.sendFile(file);
    })
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      console.warn('imagedoc hiba:', err.message.slice(0, 300));
      res.status(500).json({ error: err.message.slice(0, 300) });
    });
};

// 📄 SVG → nyomdakész vektor-PDF (a kliens imageDocToSvg kimenete → Chromium page.pdf).
// Az SVG-t FÁJLKÉNT töltjük fel (a beágyazott fotóktól nagy lehet — a mező-méret-limit
// nem gond), a vászon-méret (width/height px) mezőben jön.
exports.svgPdfHandler = (req, res) => {
  const svgFile = (req.files ?? []).find((f) => f.fieldname === 'svg');
  let svg = '';
  try {
    svg = svgFile ? fs.readFileSync(svgFile.path, 'utf8') : String(req.body.svg || '');
  } catch (caught) {
    logCaught('routes/imageTools.js', caught);
    svg = String(req.body.svg || '');
  }
  if (!svg || !svg.includes('<svg')) {
    res.status(400).json({ error: 'Hiányzó vagy hibás SVG.' });
    return;
  }
  const width = Math.max(1, Math.min(10000, Number(req.body.width) || 1080));
  const height = Math.max(1, Math.min(10000, Number(req.body.height) || 1080));
  if (!req.workDir) {
    req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
  }
  res.on('finish', () => fs.rm(req.workDir, { recursive: true, force: true }, () => {}));
  renderSvgToPdf(svg, { width, height, workDir: req.workDir })
    .then((file) => res.sendFile(file))
    .catch((err) => {
    logCaught('routes/imageTools.js', err);
      console.warn('svg/pdf hiba:', err.message.slice(0, 300));
      res.status(err.status || 500).json({ error: err.message.slice(0, 300) });
    });
};
