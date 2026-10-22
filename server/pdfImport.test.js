// 📄 PDF-import mag teszt (IMAGE 01.3) — BIZONYÍTÉK az auditban, CANVAS NÉLKÜL.
//
// A fixture PDF-et MEMÓRIÁBAN generáljuk `pdf-lib`-bel (2 oldal ELTÉRŐ mérettel),
// majd `parsePdfToImageDocs`-kal MOCK `renderPageToPng`-gel beolvassuk (fake uri —
// NINCS valós rasterizálás/tár → a teszt natív canvas nélkül fut). Az OLDAL-SZÁM és
// OLDAL-MÉRET olvasása VALÓDI (pdf-lib `getPages()`/`getSize()`) — EZ a bizonyíték,
// hogy a struktúra-parse megy. Assert: 2 ImageDoc, oldalanként helyes width/height/
// aspectRatio, egyetlen PhotoLayer a renderelt uri-val; maxPages-túllépés → beszédes hiba.

const { PDFDocument, rgb } = require('pdf-lib');
const {
  parsePdfToImageDocs,
  readPdfStructure,
  ptToPx,
  MAX_PAGES,
} = require('./pdfImport');

/** 2 oldalas fixture PDF-buffer: oldal 1 = 200×100 pt, oldal 2 = 300×400 pt. */
async function fixturePdf(sizes = [[200, 100], [300, 400]]) {
  const pdf = await PDFDocument.create();
  for (const [w, h] of sizes) {
    const page = pdf.addPage([w, h]);
    // egy kis rajz is kerüljön rá (hogy valódi, renderelhető tartalma legyen)
    page.drawRectangle({ x: 5, y: 5, width: Math.min(40, w - 10), height: Math.min(30, h - 10), color: rgb(1, 0, 0) });
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

describe('parsePdfToImageDocs — oldalanként egy ImageDoc', () => {
  let docs;
  let calls;
  beforeAll(async () => {
    calls = [];
    // MOCK rasterizáló: fake uri-t ad az oldal px-méretéből (NINCS canvas)
    const renderPageToPng = jest.fn(async (_buffer, pageIndex, size) => {
      calls.push({ pageIndex, size });
      return { src: `https://cdn.test/page-${pageIndex}.png`, uri: `https://cdn.test/page-${pageIndex}.png` };
    });
    let n = 0;
    const makeId = (p) => `${p}_${n++}`;
    // dpiScale: 2× → 200×100 pt = 400×200 px, 300×400 pt = 600×800 px
    docs = await parsePdfToImageDocs(await fixturePdf(), { makeId, renderPageToPng, name: 'Brosúra', dpiScale: 2 });
  });

  test('2 ImageDoc születik (oldalanként egy), 1-alapú oldalszámos névvel', () => {
    expect(docs).toHaveLength(2);
    expect(docs[0].name).toBe('Brosúra — 1. oldal');
    expect(docs[1].name).toBe('Brosúra — 2. oldal');
    expect(docs[0].id).toMatch(/^doc_/);
    expect(docs[1].id).toMatch(/^doc_/);
  });

  test('oldalanként helyes width/height (pt → px DPI-skálázással) + format raster', () => {
    // 200×100 pt × 2 = 400×200 px
    expect(docs[0].width).toBe(400);
    expect(docs[0].height).toBe(200);
    // 300×400 pt × 2 = 600×800 px
    expect(docs[1].width).toBe(600);
    expect(docs[1].height).toBe(800);
    for (const d of docs) {
      expect(d.format).toBe('raster');
    }
  });

  test('a legközelebbi kanonikus arány oldalanként (fekvő → 16:9, álló → 9:16)', () => {
    // 400×200 (2:1 fekvő) → a 16:9 a legközelebbi
    expect(docs[0].aspectRatio).toBe('16:9');
    // 600×800 (3:4 álló) → a 9:16 a legközelebbi
    expect(docs[1].aspectRatio).toBe('9:16');
  });

  test('oldalanként EGY PhotoLayer a teljes vászonra, a renderelt uri-val', () => {
    for (const [i, d] of docs.entries()) {
      expect(d.layers).toHaveLength(1);
      const l = d.layers[0];
      expect(l.kind).toBe('photo');
      expect(l.uri).toBe(`https://cdn.test/page-${i}.png`);
      expect(l.src).toBe(`https://cdn.test/page-${i}.png`);
      expect(l.position).toEqual({ x: 0.5, y: 0.5 });
      expect(l.w).toBe(1);
      expect(l.h).toBe(1);
      expect(l.fit).toBe('cover');
      expect(l.id).toMatch(/^lyr_/);
    }
  });

  test('a rasterizáló oldalanként HÍVÓDIK, a HELYES px-mérettel', () => {
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ pageIndex: 0, size: { w: 400, h: 200 } });
    expect(calls[1]).toEqual({ pageIndex: 1, size: { w: 600, h: 800 } });
  });
});

describe('parsePdfToImageDocs — egyetlen oldal → sima név (nincs oldalszám-utótag)', () => {
  test('1 oldalas PDF → 1 doc, a név oldalszám NÉLKÜL', async () => {
    const render = async (_b, i) => ({ uri: `u://p${i}` });
    const docs = await parsePdfToImageDocs(await fixturePdf([[150, 150]]), {
      makeId: (p) => `${p}_x`,
      renderPageToPng: render,
      name: 'Egylapos',
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('Egylapos');
    expect(docs[0].aspectRatio).toBe('1:1'); // 150×150 négyzet
  });
});

describe('parsePdfToImageDocs — hiba-ágak (barátságos, nem crash)', () => {
  const render = async (_b, i) => ({ uri: `u://p${i}` });

  test('olvashatatlan buffer → beszédes hiba', async () => {
    await expect(
      parsePdfToImageDocs(Buffer.from('definitely not a pdf'), { renderPageToPng: render })
    ).rejects.toThrow(/nem olvasható|nincs oldal/i);
  });

  test('renderPageToPng kötelező', async () => {
    await expect(parsePdfToImageDocs(await fixturePdf(), {})).rejects.toThrow(/renderPageToPng/);
  });

  test('maxPages túllépés → beszédes limit-hiba (nem crash)', async () => {
    // 4 oldalas PDF, de maxPages=2 → limit-hiba a rasterizálás ELŐTT
    const buf = await fixturePdf([[100, 100], [100, 100], [100, 100], [100, 100]]);
    const spy = jest.fn(render);
    await expect(
      parsePdfToImageDocs(buf, { renderPageToPng: spy, maxPages: 2 })
    ).rejects.toThrow(/Túl sok oldal/);
    // a limit a render ELŐTT csap le — egyetlen oldalt se rasterizáltunk
    expect(spy).not.toHaveBeenCalled();
  });

  test('túl nagy oldal-méret → beszédes hiba (a px-plafon fölött)', async () => {
    // 5000×5000 pt × 2 = 10000×10000 px > MAX_PAGE_PX (8192)
    const buf = await fixturePdf([[5000, 5000]]);
    await expect(parsePdfToImageDocs(buf, { renderPageToPng: render })).rejects.toThrow(/túl nagy/i);
  });

  test('a rasterizáló üres eredménye (nincs uri) → beszédes hiba', async () => {
    const empty = async () => ({});
    await expect(parsePdfToImageDocs(await fixturePdf([[100, 100]]), { renderPageToPng: empty })).rejects.toThrow(
      /rasterizálása nem sikerült/
    );
  });
});

describe('readPdfStructure — valódi struktúra-olvasás (pdf-lib)', () => {
  test('oldal-szám + oldalankénti méret PONTBAN (a bizonyíték)', async () => {
    const { sizesPt } = await readPdfStructure(await fixturePdf([[200, 100], [300, 400]]));
    expect(sizesPt).toHaveLength(2);
    expect(sizesPt[0]).toEqual({ widthPt: 200, heightPt: 100 });
    expect(sizesPt[1]).toEqual({ widthPt: 300, heightPt: 400 });
  });
});

describe('ptToPx — pt → px skálázás egész px-re', () => {
  test('a DPI-skála egész px-t ad (min 1×1)', () => {
    expect(ptToPx({ widthPt: 200, heightPt: 100 }, 2)).toEqual({ width: 400, height: 200 });
    expect(ptToPx({ widthPt: 0, heightPt: 0 }, 2)).toEqual({ width: 1, height: 1 });
    expect(ptToPx({ widthPt: 100.4, heightPt: 100.6 }, 1)).toEqual({ width: 100, height: 101 });
  });
});

describe('alap-konstansok', () => {
  test('MAX_PAGES értelmes default', () => {
    expect(MAX_PAGES).toBeGreaterThan(0);
  });
});
