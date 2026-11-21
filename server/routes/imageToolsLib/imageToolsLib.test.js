// 🖼️ A server/routes/imageToolsLib/ regressziós tesztjei (REFACTOR): a routes/imageTools.js bontása után a
// route-tábla (útvonal, sorrend, middleware-lánc), a távoli média feloldó-opciói (saját média-tár, SSRF-fetch),
// a PDF oldal-szám / raszter segédek és néhány handler JELENLEGI viselkedését rögzítik.
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLocal = { dir: '' };
const mockFetches = [];
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));
jest.mock('../../mediastore', () => ({
  ...jest.requireActual('../../mediastore'),
  get LOCAL_DIR() {
    return mockLocal.dir;
  },
}));
jest.mock('../../ssrf', () => ({
  ...jest.requireActual('../../ssrf'),
  safeFetchFollow: async (u, opts) => {
    mockFetches.push([u, opts]);
    return { ok: false };
  },
}));

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'imagetoolslib-'));
mockLocal.dir = path.join(ROOT, 'media');
fs.mkdirSync(path.join(mockLocal.dir, 'u'), { recursive: true });
fs.writeFileSync(path.join(mockLocal.dir, 'u', 'a.png'), 'x');
fs.mkdirSync(path.join(ROOT, 'media-evil'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'media-evil', 'b.png'), 'x');
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const router = require('../imageTools');
const { remoteMediaOpts } = require('./remoteMediaOpts');
const { probePdfPageCount, rasterPdfPage } = require('./pdfRaster');
const { bgRemoveFileHandler, depthFileHandler } = require('./assetHandlers');
const { stickers3dListHandler } = require('./assetHandlers');
const { textBakeHandler } = require('./colorHandlers');

function fakeRes() {
  const res = { code: 200, body: undefined, file: undefined };
  res.status = (c) => ((res.code = c), res);
  res.json = (b) => ((res.body = b), res);
  res.sendFile = (f) => ((res.file = f), res);
  return res;
}

describe('route-tábla (routes/imageTools.js)', () => {
  test('ugyanazok az útvonalak, ugyanabban a sorrendben, ugyanazzal a middleware-lánccal; a handler névtelen', () => {
    const table = router.stack.map((l) => [Object.keys(l.route.methods)[0], l.route.path, l.route.stack.map((s) => `${s.name}/${s.handle.length}`).join(' ')]);
    const up = 'requireAuth/3 <anonymous>/3 multerMiddleware/3 <anonymous>/3 <anonymous>/2';
    const pro = 'requireAuth/3 requirePro/3 multerMiddleware/3 <anonymous>/3 <anonymous>/2';
    expect(table).toEqual([
      ['post', '/imagedoc', up],
      ['post', '/psd/import', pro],
      ['post', '/pdf/import', pro],
      ['post', '/psd/export', pro],
      ['post', '/svg/pdf', 'requireAuth/3 <anonymous>/3 multerMiddleware/3 <anonymous>/2'],
      ['post', '/color/stats', up],
      ['post', '/color/pixel', up],
      ['post', '/color/lut-export', 'jsonParser/3 requireAuth/3 <anonymous>/3 <anonymous>/2'],
      ['post', '/color/scope', up],
      ['post', '/text/bake', 'jsonParser/3 requireAuth/3 <anonymous>/3 <anonymous>/2'],
      ['post', '/bgremove', pro],
      ['get', '/bgremove/:id/:name', 'requireAuth/3 <anonymous>/2'],
      ['get', '/stickers3d', '<anonymous>/2'],
      ['get', '/stickers3d/:id.png', '<anonymous>/2'],
      ['post', '/depth/parallax', up],
      ['post', '/depth/focus', up],
      ['get', '/depth/:id/:name', 'requireAuth/3 <anonymous>/2'],
    ]);
  });
});

describe('remoteMediaOpts', () => {
  const req = { get: (h) => (h === 'host' ? 'worker.test' : undefined) };
  test('a saját host /m/ útja a média-tárból jön; idegen host, kiszökés és testvér-mappa → null', () => {
    const { localPath } = remoteMediaOpts(req);
    expect(localPath('http://worker.test/m/u%2Fa.png')).toBe(path.join(mockLocal.dir, 'u', 'a.png'));
    expect(localPath('http://evil.test/m/u%2Fa.png')).toBeNull();
    expect(localPath('http://worker.test/m/..%2Fmedia-evil%2Fb.png')).toBeNull();
    expect(localPath('http://worker.test/m/u%2Fnincs.png')).toBeNull();
    expect(localPath('http://worker.test/x/u%2Fa.png')).toBeNull();
  });
  test('a rossz %-kódolás kivételt dob (nem null) — a jelenlegi viselkedés', () => {
    expect(() => remoteMediaOpts(req).localPath('http://worker.test/m/%E0%A4%A')).toThrow('URI malformed');
  });
  test('üres LOCAL_DIR → mindig null; a fetch a hopokat is validáló safeFetchFollow (✅ SSRF-redirect javítva)', async () => {
    // a LOCAL_DIR betöltéskor rögzül → külön modul-példány üres értékkel
    const saved = mockLocal.dir;
    mockLocal.dir = '';
    let isolated;
    jest.isolateModules(() => {
      isolated = require('./remoteMediaOpts').remoteMediaOpts;
    });
    mockLocal.dir = saved;
    expect(isolated(req).localPath('http://worker.test/m/u%2Fa.png')).toBeNull();
    const opts = remoteMediaOpts(req);
    await opts.fetchUrl('https://cdn.test/a.png');
    expect(mockFetches.pop()).toEqual(['https://cdn.test/a.png', undefined]);
  });
});

describe('pdfRaster', () => {
  test('probePdfPageCount: valódi PDF → oldal-szám; olvashatatlan → beszédes hiba', async () => {
    const { PDFDocument } = require('pdf-lib');
    const two = await PDFDocument.create();
    two.addPage();
    two.addPage();
    await expect(probePdfPageCount(Buffer.from(await two.save()))).resolves.toEqual({ pageCount: 2 });
    await expect(probePdfPageCount(Buffer.from('nem pdf'))).rejects.toThrow(/^A PDF-fájl nem olvasható: /);
  });
  test('rasterPdfPage: a kért szélességre skáláz, fehér alapra rajzol, PNG-t ad', async () => {
    const calls = [];
    const page = {
      getViewport: ({ scale }) => ({ width: 200 * scale, height: 100 * scale, scale }),
      render: (o) => (calls.push(['render', o.viewport.scale, o.canvas === o.canvasContext.canvas]), { promise: Promise.resolve() }),
    };
    const ctx = { fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]) };
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBuffer: (t) => Buffer.from(t) };
    ctx.canvas = canvas;
    const session = {
      pdf: { getPage: async (n) => (calls.push(['getPage', n]), page) },
      napiCanvas: { createCanvas: (w, h) => (calls.push(['createCanvas', w, h]), Object.assign(canvas, { width: w, height: h })) },
    };
    const png = await rasterPdfPage(session, 2, { w: 50, h: 0 });
    expect(png.toString()).toBe('image/png');
    expect(calls).toEqual([
      ['getPage', 3],
      ['createCanvas', 50, 25],
      ['fillRect', '#ffffff', 0, 0, 50, 25],
      ['render', 0.25, true],
    ]);
  });
});

describe('handlerek', () => {
  test('bgremove/depth fájl: csak 32 hex id és engedett név; hiányzó → 404', () => {
    const r1 = fakeRes();
    bgRemoveFileHandler({ params: { id: 'A'.repeat(32), name: 'cutout.png' } }, r1);
    expect([r1.code, r1.body]).toEqual([400, { error: 'Hibás kérés.' }]);
    const r2 = fakeRes();
    bgRemoveFileHandler({ params: { id: 'a'.repeat(32), name: 'cutout.png' } }, r2);
    expect([r2.code, r2.body]).toEqual([404, { error: 'Nincs ilyen kivágás.' }]);
    const r3 = fakeRes();
    depthFileHandler({ params: { id: 'a'.repeat(32), name: 'cutout.png' } }, r3);
    expect([r3.code, r3.body]).toEqual([400, { error: 'Hibás kérés.' }]);
    const r4 = fakeRes();
    depthFileHandler({ params: { id: 'a'.repeat(32), name: 'focus-far.png' } }, r4);
    expect([r4.code, r4.body]).toEqual([404, { error: 'Nincs ilyen réteg.' }]);
  });
  test('stickers3d lista: id/label/url — a belső mezők nem szivárognak', () => {
    const res = fakeRes();
    stickers3dListHandler({}, res);
    for (const e of res.body.entries) {
      expect(Object.keys(e)).toEqual(['id', 'label', 'url']);
      expect(e.url).toBe(`/stickers3d/${e.id}.png`);
    }
  });
  test('text/bake: hiányzó szöveg vagy vászon → 400', () => {
    const res = fakeRes();
    textBakeHandler({ body: { clip: { text: 'a' }, canvas: { w: 10 } } }, res);
    expect([res.code, res.body]).toEqual([400, { error: 'Hiányzó szövegklip / vászon.' }]);
  });
});
