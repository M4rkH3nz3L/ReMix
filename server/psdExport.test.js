// 🖼️ PSD-export mag teszt (IMAGE 01.2) — BIZONYÍTÉK az auditban (ROUNDTRIP).
//
// Kézzel építünk egy `ImageDoc`-ot (2 PhotoLayer + 1 ImageGroup, eltérő opacity/
// blend/hidden/position), a `fetchLayerPng`-t MOCK-oljuk (valós kis PNG-buffert ad
// vissza, pngjs-szel generálva), `buildPsdFromImageDoc`-kal PSD-t építünk, majd:
//   (A) `ag-psd` `readPsd`-vel VISSZAOLVASSUK → assert: réteg-szám, group + tagság,
//       opacity/blend/visibility, a box-ok (pixel) a doc-méretből.
//   (B) `psdImport.parsePsdToImageDoc`-kal ÚJRA-IMPORTÁLJUK → az eredeti ImageDoc
//       réteg-száma/aránya visszajön (import↔export konzisztencia).

const agPsd = require('ag-psd');
const { PNG } = require('pngjs');
const {
  buildPsdFromImageDoc,
  psdBlendMode,
  docBox,
  resolveCanvas,
  MODEL_TO_PSD,
} = require('./psdExport');
const { parsePsdToImageDoc } = require('./psdImport');

// pure-JS canvas-shim (a readPsd/writePsd createImageData-t hívhat) — a
// psdImport.test.js mintája, hogy a teszt natív canvas nélkül fusson.
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

/** valós kis PNG-buffer (w×h, tömör szín) — a `fetchLayerPng` MOCK visszaadottja. */
function solidPng(w, h, [r, g, b, a]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return PNG.sync.write(png);
}

/** a kézi fixture ImageDoc: 100×80 vászon, 2 PhotoLayer + 1 ImageGroup (1 taggal). */
function fixtureDoc() {
  return {
    id: 'doc_fixture',
    name: 'Export fixture',
    aspectRatio: '1:1',
    width: 100,
    height: 80,
    format: 'raster',
    // ALULRÓL FÖLFELÉ (a lista első eleme leghátul)
    layers: [
      // Red: gyökér-réteg, bal-felső 20×20, teljes opacity, normál blend
      {
        id: 'lyr_red',
        kind: 'photo',
        name: 'Red',
        uri: 'https://cdn.test/red.png',
        src: 'https://cdn.test/red.png',
        position: { x: 0.1, y: 0.125 },
        w: 0.2,
        h: 0.25,
        opacity: 1,
        fit: 'stretch',
      },
      // Blue: a csoport tagja, középen 20×20, 0.8 opacity, screen blend, REJTETT
      {
        id: 'lyr_blue',
        kind: 'photo',
        name: 'Blue',
        uri: 'https://cdn.test/blue.png',
        src: 'https://cdn.test/blue.png',
        position: { x: 0.5, y: 0.5 },
        w: 0.2,
        h: 0.25,
        opacity: 0.8,
        blendMode: 'screen',
        hidden: true,
        groupId: 'grp_1',
        fit: 'stretch',
      },
    ],
    groups: [{ id: 'grp_1', name: 'Grp', opacity: 0.5 }],
  };
}

/** a MOCK fetch: a réteg PNG-jét a src/uri-ból azonosítja (szín-eltéréssel). */
function makeFetch() {
  const calls = [];
  const fetchLayerPng = jest.fn(async (ref) => {
    calls.push(ref);
    // 20×20 PNG — a Red piros, a Blue kék (a tartalom itt nem számít, a méret igen)
    const isBlue = String(ref).includes('blue');
    return solidPng(20, 20, isBlue ? [0, 0, 255, 255] : [255, 0, 0, 255]);
  });
  return { fetchLayerPng, calls };
}

describe('buildPsdFromImageDoc — réteg-megőrzés (export → re-parse)', () => {
  let psdBuf;
  let read;
  let calls;

  beforeAll(async () => {
    const f = makeFetch();
    calls = f.calls;
    psdBuf = await buildPsdFromImageDoc(fixtureDoc(), { fetchLayerPng: f.fetchLayerPng });
    read = agPsd.readPsd(psdBuf, { useImageData: true, skipThumbnail: true });
  });

  test('a PSD vászon-mérete a doc width×height-ja', () => {
    expect(read.width).toBe(100);
    expect(read.height).toBe(80);
  });

  test('mindkét fotó-réteg PNG-jét lekérte a fetch (nincs elveszett réteg)', () => {
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining(['https://cdn.test/red.png', 'https://cdn.test/blue.png']));
  });

  test('a gyökér-réteg + a group külön csomópont (NEM flatten)', () => {
    // a gyökér: [Red-réteg, Grp-csoport] — a Blue a csoport gyereke
    expect(read.children).toHaveLength(2);
    const red = read.children.find((c) => c.name === 'Red');
    const grp = read.children.find((c) => c.name === 'Grp');
    expect(red).toBeTruthy();
    expect(grp).toBeTruthy();
    expect(Array.isArray(grp.children)).toBe(true);
    expect(grp.children).toHaveLength(1);
    expect(grp.children[0].name).toBe('Blue');
  });

  test('a group opacity megőrizve (~0.5)', () => {
    const grp = read.children.find((c) => c.name === 'Grp');
    expect(grp.opacity).toBeCloseTo(0.5, 1);
  });

  test('opacity / blend / visibility megőrizve a tagokon', () => {
    const red = read.children.find((c) => c.name === 'Red');
    const blue = read.children.find((c) => c.name === 'Grp').children[0];
    // Red: teljes opacity, normál blend, látható
    expect(red.opacity).toBeCloseTo(1, 2);
    expect(red.blendMode).toBe('normal');
    expect(red.hidden).toBeFalsy();
    // Blue: 0.8 opacity, screen blend, REJTETT
    expect(blue.opacity).toBeCloseTo(0.8, 1);
    expect(blue.blendMode).toBe('screen');
    expect(blue.hidden).toBe(true);
  });

  test('a box-ok PIXELRE visszajönnek a doc-méretből (a normBox fordítottja)', () => {
    const red = read.children.find((c) => c.name === 'Red');
    // (0.1,0.125) közép, (0.2,0.25) méret a 100×80 vásznon → left/top (0,0), 20×20
    expect(red.left).toBe(0);
    expect(red.top).toBe(0);
    expect(red.right).toBe(20);
    expect(red.bottom).toBe(20);
    const blue = read.children.find((c) => c.name === 'Grp').children[0];
    // (0.5,0.5) közép, (0.2,0.25) méret → left/top (40,30), 20×20
    expect(blue.left).toBe(40);
    expect(blue.top).toBe(30);
    expect(blue.right).toBe(60);
    expect(blue.bottom).toBe(50);
  });

  test('a réteg-pixelek VALÓDI RGBA-k (a PNG dekódolva került a PSD-be)', () => {
    const red = read.children.find((c) => c.name === 'Red');
    expect(red.imageData).toBeTruthy();
    expect(red.imageData.width).toBe(20);
    expect(red.imageData.height).toBe(20);
  });
});

describe('buildPsdFromImageDoc — import↔export konzisztencia (roundtrip)', () => {
  test('az exportált PSD-t a psdImport visszaolvassa az EREDETI réteg-számra/arányra', async () => {
    const f = makeFetch();
    const original = fixtureDoc();
    const psdBuf = await buildPsdFromImageDoc(original, { fetchLayerPng: f.fetchLayerPng });

    // a psdImport injektált uploadLayerPng-je (mock URL) → nincs valós tár
    let n = 0;
    const reimported = await parsePsdToImageDoc(psdBuf, {
      makeId: (p) => `${p}_${n++}`,
      uploadLayerPng: async (_png, id) => ({ src: `u://${id}`, uri: `u://${id}` }),
      name: 're',
    });

    // a réteg-szám konzisztens (2 fotó-réteg visszajön)
    expect(reimported.layers).toHaveLength(original.layers.length);
    // a group visszajön (1 ImageGroup), a tag groupId-ja rámutat
    expect(reimported.groups).toHaveLength(1);
    const blue = reimported.layers.find((l) => l.name === 'Blue');
    const red = reimported.layers.find((l) => l.name === 'Red');
    expect(blue.groupId).toBe(reimported.groups[0].id);
    expect(red.groupId).toBeUndefined();

    // az arány a width/height-ból: 100×80 → a kanonikus besorolás az eredetivel egyezik
    expect(reimported.width).toBe(original.width);
    expect(reimported.height).toBe(original.height);
    expect(reimported.aspectRatio).toBe(original.aspectRatio);

    // a blend/visibility is túléli a roundtripot
    expect(blue.blendMode).toBe('screen');
    expect(blue.hidden).toBe(true);
    // a box-ok (0–1) ~visszajönnek (pixel-kerekítés tűréssel)
    expect(blue.position.x).toBeCloseTo(0.5, 2);
    expect(blue.position.y).toBeCloseTo(0.5, 2);
    expect(red.position.x).toBeCloseTo(0.1, 2);
  });
});

describe('buildPsdFromImageDoc — hiba-ágak (barátságos, nem crash)', () => {
  const fetchLayerPng = async () => solidPng(2, 2, [0, 0, 0, 255]);

  test('fetchLayerPng kötelező', async () => {
    await expect(buildPsdFromImageDoc(fixtureDoc(), {})).rejects.toThrow(/fetchLayerPng/);
  });

  test('érvénytelen doc (nincs layers) → beszédes hiba', async () => {
    await expect(buildPsdFromImageDoc({ width: 10, height: 10 }, { fetchLayerPng })).rejects.toThrow(/réteg-lista/);
  });

  test('túl nagy vászon → beszédes hiba (nem crash)', async () => {
    await expect(
      buildPsdFromImageDoc({ width: 99999, height: 10, layers: [] }, { fetchLayerPng })
    ).rejects.toThrow(/túl nagy/i);
  });

  test('nincs exportálható (rasterizálható) réteg → beszédes hiba', async () => {
    // egy text-réteg rasterizáló NÉLKÜL → kimarad → nincs exportálható réteg
    const doc = {
      id: 'd',
      name: 'empty',
      aspectRatio: '1:1',
      width: 50,
      height: 50,
      layers: [{ id: 't', kind: 'text', name: 'T', text: 'hi', position: { x: 0.5, y: 0.5 } }],
    };
    await expect(buildPsdFromImageDoc(doc, { fetchLayerPng })).rejects.toThrow(/exportálható réteg/);
  });

  test('a fetch null-t ad (letöltés sikertelen) → a réteg kimarad, nem crash', async () => {
    const doc = fixtureDoc();
    // mindkét fetch null → nincs pixel → nincs exportálható réteg (beszédes hiba)
    await expect(buildPsdFromImageDoc(doc, { fetchLayerPng: async () => null })).rejects.toThrow(/exportálható réteg/);
  });
});

describe('nem-fotó réteg rasterizálóval (text/shape → raszter-réteg)', () => {
  test('a rasterizeLayerPng PNG-je raszter-rétegként kerül a PSD-be', async () => {
    const doc = {
      id: 'd',
      name: 'rast',
      aspectRatio: '1:1',
      width: 60,
      height: 60,
      layers: [
        // `shape` mező NÉLKÜL (ismeretlen forma) → NEM vektorizálható → raszter-fallback
        { id: 'sh', kind: 'shape', name: 'Box', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5 },
      ],
    };
    const psdBuf = await buildPsdFromImageDoc(doc, {
      fetchLayerPng: async () => null,
      rasterizeLayerPng: async () => solidPng(30, 30, [0, 255, 0, 255]),
    });
    const read = agPsd.readPsd(psdBuf, { useImageData: true, skipThumbnail: true });
    expect(read.children).toHaveLength(1);
    expect(read.children[0].name).toBe('Box');
    expect(read.children[0].imageData.width).toBe(30);
  });
});

describe('shape-réteg → PSD-VEKTOR (VECTOR 03.2) — él-vektor, NEM raszter', () => {
  /** 1 zárt Bézier-path (3 pont, fogókkal) + 1 téglalap (kontúrral) — mind shape-réteg */
  function vectorDoc() {
    return {
      id: 'vd',
      name: 'vector',
      aspectRatio: '1:1',
      width: 100,
      height: 80,
      layers: [
        // zárt köbös Bézier path, fill-lel (NINCS border → nincs stroke)
        {
          id: 'p1',
          kind: 'shape',
          shape: 'path',
          name: 'Blob',
          position: { x: 0.5, y: 0.5 },
          w: 0.6,
          h: 0.6,
          fill: '#ff3300',
          closed: true,
          points: [
            { x: 0.5, y: 0, h2: { x: 0.8, y: 0.1 } },
            { x: 1, y: 1, h1: { x: 0.9, y: 0.7 } },
            { x: 0, y: 1 },
          ],
        },
        // téglalap fill + kontúr → vectorFill + vectorStroke
        {
          id: 'r1',
          kind: 'shape',
          shape: 'rectangle',
          name: 'Rect',
          position: { x: 0.3, y: 0.3 },
          w: 0.4,
          h: 0.2,
          fill: '#00cc66',
          borderColor: '#000000',
          borderWidth: 2,
        },
      ],
    };
  }

  let read;
  beforeAll(async () => {
    // a fetchLayerPng SOHA nem hívódik (nincs fotó-réteg); rasterizáló SINCS →
    // ha bármelyik shape raszterre esne, elveszne — a teszt bizonyítja, hogy VEKTOR
    const psdBuf = await buildPsdFromImageDoc(vectorDoc(), { fetchLayerPng: async () => null });
    read = agPsd.readPsd(psdBuf, { useImageData: false, skipThumbnail: true });
  });

  test('mindkét shape-réteg bekerült (vektorként, raszter/rasterizáló NÉLKÜL)', () => {
    expect(read.children).toHaveLength(2);
    expect(read.children.map((c) => c.name).sort()).toEqual(['Blob', 'Rect']);
  });

  test('a path-réteg ÉL-VEKTOR: vectorMask + knot-szám + vectorFill szín', () => {
    const blob = read.children.find((c) => c.name === 'Blob');
    expect(blob.vectorMask).toBeTruthy();
    expect(blob.vectorMask.paths).toHaveLength(1);
    expect(blob.vectorMask.paths[0].open).toBe(false); // zárt
    expect(blob.vectorMask.paths[0].knots).toHaveLength(3); // 3 horgony
    // NINCS beégetett raszter-pixel → tiszta vektor
    expect(blob.imageData).toBeFalsy();
    // a fill szín visszaolvasható
    expect(blob.vectorFill).toEqual({ type: 'color', color: { r: 255, g: 51, b: 0 } });
    // nincs border → nincs stroke
    expect(blob.vectorStroke).toBeFalsy();
  });

  test('a Bézier-fogók a doc-pixelbe transzformálva jönnek vissza', () => {
    const blob = read.children.find((c) => c.name === 'Blob');
    // 0.6×0.6 doboz (0.5,0.5) középen a 100×80 vásznon → left=20 top=16 bw=60 bh=48
    // 1. horgony (0.5,0) → (50,16); h2 (0.8,0.1) = cpAfter → (68, 20.8)
    const k0 = blob.vectorMask.paths[0].knots[0].points.map((v) => Math.round(v * 100) / 100);
    expect(k0[2]).toBeCloseTo(50); // anchor x
    expect(k0[3]).toBeCloseTo(16); // anchor y
    expect(k0[4]).toBeCloseTo(68); // cpAfter x (h2)
    expect(k0[5]).toBeCloseTo(20.8); // cpAfter y (h2)
  });

  test('a téglalap ÉL-VEKTOR: 4 sarok-knot + vectorFill + vectorStroke (kontúr)', () => {
    const rect = read.children.find((c) => c.name === 'Rect');
    expect(rect.vectorMask.paths[0].knots).toHaveLength(4);
    expect(rect.vectorFill.color).toEqual({ r: 0, g: 204, b: 102 });
    expect(rect.vectorStroke).toBeTruthy();
    expect(rect.vectorStroke.content.color).toEqual({ r: 0, g: 0, b: 0 });
    // borderWidth 2% * 80 (vászon-magasság) = 1.6px
    expect(rect.vectorStroke.lineWidth.value).toBeCloseTo(1.6);
  });

  test('NYITOTT path → vonal-vektor (vectorStroke a fill színnel, nincs vectorFill)', async () => {
    const doc = {
      id: 'op',
      name: 'open',
      aspectRatio: '1:1',
      width: 100,
      height: 100,
      layers: [
        {
          id: 'ln',
          kind: 'shape',
          shape: 'path',
          name: 'Line',
          position: { x: 0.5, y: 0.5 },
          w: 1,
          h: 1,
          fill: '#2200ff',
          closed: false,
          strokeWidth: 4,
          points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }],
        },
      ],
    };
    const buf = await buildPsdFromImageDoc(doc, { fetchLayerPng: async () => null });
    const r = agPsd.readPsd(buf, { useImageData: false, skipThumbnail: true });
    const line = r.children[0];
    expect(line.vectorMask.paths[0].open).toBe(true);
    expect(line.vectorMask.paths[0].knots).toHaveLength(3);
    expect(line.vectorFill).toBeFalsy(); // nyitott → nincs kitöltés
    expect(line.vectorStroke.content.color).toEqual({ r: 34, g: 0, b: 255 });
    expect(line.vectorStroke.lineWidth.value).toBeCloseTo(4); // 4% * 100
  });

  test('1-pontos path (nem vektorizálható) → raszter-fallback a rasterizálóval', async () => {
    const doc = {
      id: 'bad',
      name: 'bad',
      aspectRatio: '1:1',
      width: 50,
      height: 50,
      layers: [
        { id: 's', kind: 'shape', shape: 'path', name: 'Dot', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#000', points: [{ x: 0.5, y: 0.5 }] },
      ],
    };
    const buf = await buildPsdFromImageDoc(doc, {
      fetchLayerPng: async () => null,
      rasterizeLayerPng: async () => solidPng(10, 10, [0, 0, 0, 255]),
    });
    const r = agPsd.readPsd(buf, { useImageData: true, skipThumbnail: true });
    expect(r.children).toHaveLength(1);
    // raszter-réteg lett (nincs vektor-mask), de a réteg NEM veszett el
    expect(r.children[0].imageData).toBeTruthy();
    expect(r.children[0].vectorMask).toBeFalsy();
  });
});

describe('segéd-fn-ek (a reverz-leképezés + box + canvas)', () => {
  test('psdBlendMode: a BLEND_MAP megfordítása (1:1 párok kanonikusan)', () => {
    expect(psdBlendMode('multiply')).toBe('multiply');
    expect(psdBlendMode('screen')).toBe('screen');
    expect(psdBlendMode('overlay')).toBe('overlay');
    expect(psdBlendMode('hardlight')).toBe('hard light');
    expect(psdBlendMode('softlight')).toBe('soft light');
    expect(psdBlendMode('colordodge')).toBe('color dodge');
    expect(psdBlendMode('colorburn')).toBe('color burn');
    // ismeretlen / hiányzó → 'normal'
    expect(psdBlendMode('nope')).toBe('normal');
    expect(psdBlendMode(undefined)).toBe('normal');
    expect(psdBlendMode(null)).toBe('normal');
  });

  test('MODEL_TO_PSD: a kanonikus (első) PSD-nevet választja a duplikátok közül', () => {
    // 'screen' modell-blendre a BLEND_MAP-ban 'screen' ÉS 'linear dodge' is esik →
    // a reverz az ELSŐT ('screen') tartja (a kanonikus 1:1 párt)
    expect(MODEL_TO_PSD.screen).toBe('screen');
    expect(MODEL_TO_PSD.multiply).toBe('multiply');
  });

  test('docBox: a normBox fordítottja — 0–1 közép+méret → PSD-pixel', () => {
    // (0.1,0.125) közép, (0.2,0.25) méret a 100×80 vásznon → (0,0)…(20,20)
    expect(docBox({ position: { x: 0.1, y: 0.125 }, w: 0.2, h: 0.25 }, 100, 80)).toEqual({
      left: 0,
      top: 0,
      right: 20,
      bottom: 20,
    });
  });

  test('docBox: box nélküli réteg (text/adjust) → teljes vászon', () => {
    expect(docBox({ kind: 'adjust' }, 120, 90)).toEqual({ left: 0, top: 0, right: 120, bottom: 90 });
  });

  test('resolveCanvas: explicit W×H → az; arány → alap-felbontás', () => {
    expect(resolveCanvas({ width: 640, height: 480 })).toEqual({ canvasW: 640, canvasH: 480 });
    expect(resolveCanvas({ aspectRatio: '1:1' })).toEqual({ canvasW: 1080, canvasH: 1080 });
    const portrait = resolveCanvas({ aspectRatio: '9:16' });
    expect(portrait.canvasH).toBe(1080);
    expect(portrait.canvasW).toBeLessThan(portrait.canvasH);
  });
});
