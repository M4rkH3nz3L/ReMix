// 🖼️ PSD-import mag teszt (IMAGE 01.1) — BIZONYÍTÉK az auditban.
//
// A fixture PSD-t MEMÓRIÁBAN generáljuk `ag-psd` `writePsd`-del (2 raszter-réteg
// + 1 group eltérő opacity/blend/hidden-nel), majd `parsePsdToImageDoc`-kal
// beolvassuk. Az `uploadLayerPng` MOCK (fake URL) → nincs valós tár. Assert:
// réteg-szám, PhotoLayer-ek, a group bekötve (groupId + ImageGroup), opacity/blend/
// visibility megőrizve, a box-ok 0–1-ben. A `writePsd`-hez is a pure-JS canvas-
// shim kell (a `parsePsdToImageDoc` a `readPsd`-hez init-eli — itt a writerhez
// külön regisztráljuk ugyanazt).

const agPsd = require('ag-psd');
const { PNG } = require('pngjs');
const {
  parsePsdToImageDoc,
  mapBlendMode,
  normBox,
  nearestAspect,
  countLeafLayers,
  imageDataToPng,
  MAX_LAYERS,
} = require('./psdImport');

// pure-JS canvas-shim a fixture-generáláshoz (a writer is createImageData-t hívhat)
beforeAll(() => {
  const createImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const createCanvas = (w, h) => ({
    width: w,
    height: h,
    getContext: () => ({
      createImageData: (ww, hh) => createImageData(ww, hh),
      getImageData: (_x, _y, ww, hh) => createImageData(ww, hh),
      putImageData: () => {},
      drawImage: () => {},
    }),
  });
  agPsd.initializeCanvas(createCanvas, createImageData);
});

/** tömör RGBA ImageData (w×h, adott színnel). */
function solid(w, h, [r, g, b, a]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

/** egy fixture PSD-buffer: 100×80 vászon, 2 raszter-réteg + 1 group (1 taggal). */
function fixturePsd() {
  const psd = {
    width: 100,
    height: 80,
    children: [
      // háttér-raszter: bal-felső 20×20 piros, teljes opacity, normál blend
      { name: 'Red', left: 0, top: 0, right: 20, bottom: 20, opacity: 1, imageData: solid(20, 20, [255, 0, 0, 255]) },
      // csoport: fél-opacity + multiply blend, benne egy REJTETT, screen-blend tag
      {
        name: 'Grp',
        opened: true,
        opacity: 0.5,
        blendMode: 'multiply',
        children: [
          {
            name: 'Blue',
            left: 40,
            top: 30,
            right: 60,
            bottom: 50,
            opacity: 0.8,
            blendMode: 'screen',
            hidden: true,
            imageData: solid(20, 20, [0, 0, 255, 255]),
          },
        ],
      },
    ],
  };
  return agPsd.writePsd(psd, { imageDataStyle: 'raw', generateThumbnail: false });
}

describe('parsePsdToImageDoc — réteg-megőrzés', () => {
  let doc;
  let uploads;
  beforeAll(async () => {
    uploads = [];
    const uploadLayerPng = jest.fn(async (png, layerId) => {
      uploads.push({ png, layerId });
      return { src: `https://cdn.test/${layerId}.png`, uri: `https://cdn.test/${layerId}.png` };
    });
    let n = 0;
    const makeId = (p) => `${p}_${n++}`;
    doc = await parsePsdToImageDoc(fixturePsd(), { makeId, uploadLayerPng, name: 'Fixture' });
  });

  test('a dokumentum alap-mezői (név, vászon W×H, raster-format, arány)', () => {
    expect(doc.name).toBe('Fixture');
    expect(doc.width).toBe(100);
    expect(doc.height).toBe(80);
    expect(doc.format).toBe('raster');
    // 100:80 = 1.25; a log-közelítésben az 1:1 (1.0) közelebb van, mint a 16:9 (1.778).
    // A `width`/`height` úgyis mérvadó a renderernek — az arány csak a fallback-besorolás.
    expect(doc.aspectRatio).toBe('1:1');
    expect(doc.id).toMatch(/^doc_/);
  });

  test('mindkét raszter-réteg PhotoLayer, feltöltött URL-lel (nincs elveszett réteg)', () => {
    expect(doc.layers).toHaveLength(2);
    for (const l of doc.layers) {
      expect(l.kind).toBe('photo');
      expect(l.uri).toMatch(/^https:\/\/cdn\.test\//);
      expect(l.fit).toBe('stretch');
    }
    // mindkét réteg PNG-je feltöltődött
    expect(uploads).toHaveLength(2);
    // amit feltöltöttünk, az ÉRVÉNYES PNG (pngjs-szel vissza is olvasható)
    for (const u of uploads) {
      const back = PNG.sync.read(u.png);
      expect(back.width).toBeGreaterThan(0);
      expect(back.height).toBeGreaterThan(0);
    }
  });

  test('a név megőrizve a rétegeken', () => {
    const names = doc.layers.map((l) => l.name);
    expect(names).toContain('Red');
    expect(names).toContain('Blue');
  });

  test('a group ImageGroup-ként bekötve + a tag groupId-ja mutat rá', () => {
    expect(doc.groups).toHaveLength(1);
    const grp = doc.groups[0];
    expect(grp.name).toBe('Grp');
    expect(grp.hidden).toBeUndefined(); // a group maga nem rejtett
    // a group fél-opacity (255-skálás kerekítés → ~0.5)
    expect(grp.opacity).toBeCloseTo(0.5, 1);
    const blue = doc.layers.find((l) => l.name === 'Blue');
    expect(blue.groupId).toBe(grp.id);
    // a csoporton kívüli réteg NEM kap groupId-t
    const red = doc.layers.find((l) => l.name === 'Red');
    expect(red.groupId).toBeUndefined();
  });

  test('opacity / blend / visibility megőrizve a tagon', () => {
    const blue = doc.layers.find((l) => l.name === 'Blue');
    expect(blue.opacity).toBeCloseTo(0.8, 1);
    expect(blue.blendMode).toBe('screen');
    expect(blue.hidden).toBe(true);
    const red = doc.layers.find((l) => l.name === 'Red');
    expect(red.opacity).toBeCloseTo(1, 2);
    expect(red.blendMode).toBeUndefined(); // normál → nincs blend-mező
    expect(red.hidden).toBeUndefined();
  });

  test('a box-ok 0–1-ben normalizálva (középpont + méret a vászonra)', () => {
    const red = doc.layers.find((l) => l.name === 'Red');
    // 0..20 a 100×80 vásznon → közép (10/100, 10/80) = (0.1, 0.125), méret (0.2, 0.25)
    expect(red.position.x).toBeCloseTo(0.1, 3);
    expect(red.position.y).toBeCloseTo(0.125, 3);
    expect(red.w).toBeCloseTo(0.2, 3);
    expect(red.h).toBeCloseTo(0.25, 3);
    const blue = doc.layers.find((l) => l.name === 'Blue');
    // 40..60 × 30..50 → közép (50/100, 40/80) = (0.5, 0.5), méret (0.2, 0.25)
    expect(blue.position.x).toBeCloseTo(0.5, 3);
    expect(blue.position.y).toBeCloseTo(0.5, 3);
    expect(blue.w).toBeCloseTo(0.2, 3);
    expect(blue.h).toBeCloseTo(0.25, 3);
    // minden koordináta a [0,1] zárt intervallumban
    for (const l of doc.layers) {
      for (const v of [l.position.x, l.position.y, l.w, l.h]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('parsePsdToImageDoc — hiba-ágak (barátságos, nem crash)', () => {
  const upload = async (_png, id) => ({ src: `u://${id}`, uri: `u://${id}` });

  test('olvashatatlan buffer → beszédes hiba', async () => {
    await expect(parsePsdToImageDoc(Buffer.from('not a psd at all'), { uploadLayerPng: upload })).rejects.toThrow(
      /nem olvasható|vászon-mérete/i
    );
  });

  test('uploadLayerPng kötelező', async () => {
    await expect(parsePsdToImageDoc(fixturePsd(), {})).rejects.toThrow(/uploadLayerPng/);
  });

  test('túl sok réteg → beszédes limit-hiba (nem crash)', async () => {
    const many = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({
      name: `L${i}`,
      left: 0,
      top: 0,
      right: 2,
      bottom: 2,
      imageData: solid(2, 2, [1, 2, 3, 255]),
    }));
    const buf = agPsd.writePsd({ width: 10, height: 10, children: many }, { imageDataStyle: 'raw', generateThumbnail: false });
    await expect(parsePsdToImageDoc(buf, { uploadLayerPng: upload })).rejects.toThrow(/Túl sok réteg/);
  });
});

describe('PSD blend-mode → modell-enum képzés', () => {
  test('ismert módok leképezve', () => {
    expect(mapBlendMode('multiply')).toBe('multiply');
    expect(mapBlendMode('screen')).toBe('screen');
    expect(mapBlendMode('Overlay')).toBe('overlay'); // kis-/nagybetű-tolerancia
    expect(mapBlendMode('hard light')).toBe('hardlight');
    expect(mapBlendMode('soft light')).toBe('softlight');
    expect(mapBlendMode('color dodge')).toBe('colordodge');
    expect(mapBlendMode('color burn')).toBe('colorburn');
    // közeli leképezés (nincs 1:1 enum)
    expect(mapBlendMode('linear dodge')).toBe('screen');
    expect(mapBlendMode('linear burn')).toBe('multiply');
  });

  test('ismeretlen / normal / üres → null (source-over fallback — nincs blend-mező)', () => {
    expect(mapBlendMode('normal')).toBeNull();
    expect(mapBlendMode('pass through')).toBeNull();
    expect(mapBlendMode('dissolve')).toBeNull();
    expect(mapBlendMode('')).toBeNull();
    expect(mapBlendMode(undefined)).toBeNull();
  });
});

describe('segéd-fn-ek', () => {
  test('normBox: degenerált box → teljes vászon, középen', () => {
    expect(normBox({ left: 0, top: 0, right: 0, bottom: 0 }, 100, 100)).toEqual({
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
    });
  });

  test('nearestAspect: a 3 kanonikus arányhoz közelít', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(500, 500)).toBe('1:1');
  });

  test('countLeafLayers: a group-okat NEM számolja, a tagokat igen (rekurzívan)', () => {
    const tree = [
      { name: 'a', imageData: solid(1, 1, [0, 0, 0, 0]) },
      { name: 'g', children: [{ name: 'b' }, { name: 'c', children: [{ name: 'd' }] }] },
    ];
    expect(countLeafLayers(tree)).toBe(3); // a, b, d (c group, g group)
  });

  test('imageDataToPng: üres/hibás bemenet → null (nem dob)', () => {
    expect(imageDataToPng(null)).toBeNull();
    expect(imageDataToPng({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });
});
