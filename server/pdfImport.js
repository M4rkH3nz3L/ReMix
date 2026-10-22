// 📄 PDF-import mag (IMAGE 01.3): PDF → `ImageDoc`-ok, oldalanként EGY dokumentum.
//
// ELV (a `psdImport.js` mintája): a parser-mag TISZTA. A STRUKTÚRÁT (oldal-szám +
// oldalankénti W×H) a `pdf-lib`-bel olvassuk — pure-JS, nincs natív függőség, így
// a jest canvas NÉLKÜL fut. A lap→PNG RASZTERIZÁLÁS INJEKTÁLT (`renderPageToPng`):
// prod-ban pdfjs+canvas renderel + a média-tárba tölt, TESZTben mock (fake uri). A
// `makeId` is injektált → tesztelhető valós tár nélkül.
//
// A több-oldalas PDF → `imageProjectPages` konvenciója: oldalanként EGY `ImageDoc`,
// a vászon az oldal px-mérete (pt → px DPI-skálázással), egyetlen `PhotoLayer` a
// teljes vászonra, aminek az uri-ja a renderelt oldal-PNG. Az import oldalanként EGY
// undo-lépés — a mag csak az `ImageDoc[]`-tömböt adja, a command-busra a kliens teszi.

const { PDFDocument } = require('pdf-lib');
const { nearestAspect } = require('./psdImport');

// 🛡️ Védőkorlátok: egy pathológikus PDF (sok száz oldal / óriás vászon) elfogyasztaná
// az erőforrást a rasterizálásnál. Inkább BESZÉDES (magyar) hiba, mint crash/elakadás.
const MAX_PAGES = 30; // default oldal-plafon (a hívó `maxPages`-szel szűkítheti)
const MAX_PAGE_PX = 8192; // a renderelt oldal leghosszabb oldalának px-plafonja
const DEFAULT_DPI_SCALE = 2; // pt → px: 2× (≈144 DPI a PDF 72 pt/inch bázisán)

/** 0 fölötti véges egész, vagy a `fallback` (a rossz/hiányzó méretek ellen). */
function posInt(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * A PDF STRUKTÚRÁJA (pure-JS, `pdf-lib`): oldal-szám + oldalankénti méret PONTBAN
 * (pt). A `getSize()` a MediaBox-méret (a PDF natív 72 pt/inch rendszerében). A
 * rasterizáláskor ezt skálázzuk px-re. Olvashatatlan PDF → beszédes hiba (nem crash).
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer a .pdf nyers tartalma
 * @returns {Promise<{ sizesPt: {widthPt:number, heightPt:number}[] }>}
 */
async function readPdfStructure(buffer) {
  let pdf;
  try {
    const bytes = toUint8(buffer);
    // `ignoreEncryption`: a csak-olvasásra titkosított (jelszó NÉLKÜLI, csak
    // engedély-flagelt) PDF-ek is beolvashatók legyenek — a struktúra-olvasás
    // nem módosít, ezért biztonságos.
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw new Error(
      `A PDF-fájl nem olvasható: ${String(err && err.message ? err.message : err).slice(0, 160)}`
    );
  }
  const pages = pdf.getPages();
  if (!pages || pages.length === 0) {
    throw new Error('A PDF-ben nincs oldal.');
  }
  const sizesPt = pages.map((p) => {
    const s = p.getSize();
    return { widthPt: Number(s.width) || 0, heightPt: Number(s.height) || 0 };
  });
  return { sizesPt };
}

/** pt-méret → egész px-méret a DPI-skálával (min 1×1). */
function ptToPx({ widthPt, heightPt }, scale) {
  return {
    width: Math.max(1, Math.round((Number(widthPt) || 0) * scale)),
    height: Math.max(1, Math.round((Number(heightPt) || 0) * scale)),
  };
}

/**
 * 📄 PDF-buffer → `ImageDoc[]` (oldalanként egy dokumentum). PURE-ish mag: a
 * `makeId` és a `renderPageToPng` INJEKTÁLT.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer a .pdf nyers tartalma
 * @param {object} opts
 * @param {(prefix:string)=>string} opts.makeId azonosító-generátor (prefix-szel)
 * @param {(buffer, pageIndex:number, size:{w:number,h:number})=>Promise<{src?:string, uri?:string}>} opts.renderPageToPng
 *        az adott oldal (0-alapú index) PNG-vé rasterizálója → a réteg `src`/`uri`-ja
 *        (prod: pdfjs+canvas renderel + feltölt; teszt: mock fake uri-t ad)
 * @param {string} [opts.name] a dokumentumok alap-neve (hiányzó = 'PDF')
 * @param {number} [opts.maxPages] oldal-plafon (default `MAX_PAGES`)
 * @param {number} [opts.dpiScale] pt → px skála (default `DEFAULT_DPI_SCALE`)
 * @returns {Promise<ImageDoc[]>} oldalanként egy `ImageDoc`
 * @throws {Error} barátságos (magyar) hibaüzenettel (olvashatatlan / túl sok oldal /
 *         túl nagy oldal-méret) — a UI ezt mutatja, nem crash.
 */
async function parsePdfToImageDocs(buffer, opts = {}) {
  const makeId = typeof opts.makeId === 'function' ? opts.makeId : defaultMakeId();
  const renderPageToPng = opts.renderPageToPng;
  if (typeof renderPageToPng !== 'function') {
    throw new Error('renderPageToPng rasterizáló-függvény kötelező.');
  }
  const maxPages = posInt(opts.maxPages, MAX_PAGES);
  const scale = Number.isFinite(Number(opts.dpiScale)) && Number(opts.dpiScale) > 0
    ? Number(opts.dpiScale)
    : DEFAULT_DPI_SCALE;
  const baseName = typeof opts.name === 'string' && opts.name ? opts.name : 'PDF';

  const { sizesPt } = await readPdfStructure(buffer);

  // 🛡️ oldal-szám gát a rasterizálás ELŐTT (a költséges render-hívások előtt)
  if (sizesPt.length > maxPages) {
    throw new Error(
      `Túl sok oldal a PDF-ben (${sizesPt.length} > ${maxPages}). Importálj kevesebb oldalt, vagy darabold a PDF-et.`
    );
  }

  // 🛡️ oldal-méret plafon: a px-re skálázott legnagyobb oldal se lépje túl a limitet
  for (let i = 0; i < sizesPt.length; i++) {
    const px = ptToPx(sizesPt[i], scale);
    if (px.width > MAX_PAGE_PX || px.height > MAX_PAGE_PX) {
      throw new Error(
        `A ${i + 1}. oldal túl nagy (${px.width}×${px.height}px; max ${MAX_PAGE_PX}px/oldal). Kisebb felbontással exportáld a PDF-et.`
      );
    }
  }

  const bufferForRender = toUint8(buffer);
  const docs = [];
  for (let i = 0; i < sizesPt.length; i++) {
    const { width, height } = ptToPx(sizesPt[i], scale);
    // az oldal rasterizálása (injektált): prod pdfjs+canvas, teszt mock
    const rendered = await renderPageToPng(bufferForRender, i, { w: width, h: height });
    const uri = rendered && (rendered.uri || rendered.src);
    if (!uri) {
      throw new Error(`A ${i + 1}. oldal rasterizálása nem sikerült (nincs kép-URL).`);
    }
    // egyetlen fotó-réteg a TELJES vászonra: középen, 1×1, cover (az oldal-PNG
    // pontosan a vászon mérete, így a cover/stretch pixelpontos kitöltés)
    const layer = {
      id: makeId('lyr'),
      kind: 'photo',
      uri,
      ...(rendered.src ? { src: rendered.src } : {}),
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fit: 'cover',
    };
    docs.push({
      id: makeId('doc'),
      // oldalanként egyedi név (1-alapú oldalszám), hogy a galériában megkülönböztethető
      name: sizesPt.length > 1 ? `${baseName} — ${i + 1}. oldal` : baseName,
      aspectRatio: nearestAspect(width, height),
      width,
      height,
      format: 'raster',
      layers: [layer],
    });
  }
  return docs;
}

/** Node Buffer / ArrayBuffer / Uint8Array → Uint8Array (a pdf-lib/pdfjs ezt kéri). */
function toUint8(buf) {
  if (!buf) {
    throw new Error('Üres PDF-buffer.');
  }
  if (buf instanceof Uint8Array) {
    return buf;
  }
  if (buf instanceof ArrayBuffer) {
    return new Uint8Array(buf);
  }
  // Node Buffer is Uint8Array, de a biztonság kedvéért másoljuk nézetre
  return new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
}

/** tartalék id-generátor (ha a hívó nem ad) — a teszt/kliens úgyis injektál. */
function defaultMakeId() {
  let n = 0;
  return (prefix) => `${prefix}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  parsePdfToImageDocs,
  readPdfStructure,
  ptToPx,
  MAX_PAGES,
  MAX_PAGE_PX,
  DEFAULT_DPI_SCALE,
};
