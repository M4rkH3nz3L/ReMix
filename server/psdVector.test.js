// 🔷 Shape → PSD-vektor geometria teszt (VECTOR 03.2) — a `psdVector.js` mag
// egység-tesztjei + egy MINIMÁLIS ag-psd roundtrip-PRÓBA (writePsd vectorMask →
// readPsd), ami BIZONYÍTJA, hogy az él-vektor (knots + fill + stroke) PONTOSAN
// visszaolvasható. Pure-JS: NINCS natív canvas (a shim a readPsd/writePsd-hez).

const agPsd = require('ag-psd');
const {
  shapeToVector,
  shapePaths,
  parseColor,
  boxOf,
  knotFromPathPoint,
  cornerKnot,
  rectKnots,
  ellipseKnots,
  starKnots,
  arrowKnots,
} = require('./psdVector');

beforeAll(() => {
  const cid = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const cc = (w, h) => ({
    width: w,
    height: h,
    getContext: () => ({
      createImageData: (a, b) => cid(a, b),
      getImageData: (_x, _y, a, b) => cid(a, b),
      putImageData: () => {},
      drawImage: () => {},
    }),
  });
  agPsd.initializeCanvas(cc, cid);
});

describe('parseColor — hex/rgb → {r,g,b} 0–255', () => {
  test('#rrggbb', () => {
    expect(parseColor('#ff3300')).toEqual({ r: 255, g: 51, b: 0 });
  });
  test('#rgb rövid alak', () => {
    expect(parseColor('#f30')).toEqual({ r: 255, g: 51, b: 0 });
  });
  test('rgb() / rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });
  test('hibás bemenet → fekete', () => {
    expect(parseColor(undefined)).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor('nope')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('boxOf — a svgExport.boxOf párja (position = középpont, doc-pixel)', () => {
  test('0.5 közép, 0.6×0.6 a 100×80 vásznon', () => {
    const b = boxOf({ position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6 }, 100, 80);
    expect(b.bw).toBeCloseTo(60);
    expect(b.bh).toBeCloseTo(48);
    expect(b.left).toBeCloseTo(20);
    expect(b.top).toBeCloseTo(16);
  });
});

describe('knotFromPathPoint — h1=cpBefore, anchor, h2=cpAfter (doc-pixel)', () => {
  const b = boxOf({ position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6 }, 100, 80); // left20 top16 bw60 bh48
  test('fogókkal: [cpBefore, anchor, cpAfter]', () => {
    const k = knotFromPathPoint({ x: 0.5, y: 0, h1: { x: 0.2, y: 0.1 }, h2: { x: 0.8, y: 0.1 } }, b);
    // anchor (0.5,0) → (50,16)
    expect(k.points[2]).toBeCloseTo(50);
    expect(k.points[3]).toBeCloseTo(16);
    // cpBefore (0.2,0.1) → (32, 20.8)
    expect(k.points[0]).toBeCloseTo(32);
    expect(k.points[1]).toBeCloseTo(20.8);
    // cpAfter (0.8,0.1) → (68, 20.8)
    expect(k.points[4]).toBeCloseTo(68);
    expect(k.points[5]).toBeCloseTo(20.8);
    expect(k.linked).toBe(true);
  });
  test('fogók nélkül: a fogók = a horgony (egyenes szegmens)', () => {
    const k = knotFromPathPoint({ x: 0, y: 1 }, b); // (0,1) → (20, 64)
    expect(k.points).toEqual([20, 64, 20, 64, 20, 64]);
    expect(k.linked).toBe(false);
  });
});

describe('alap-formák → knot-geometria (a svgExport matekja)', () => {
  const b = boxOf({ position: { x: 0.5, y: 0.5 }, w: 1, h: 1 }, 100, 100);
  test('rectangle: 4 sarok (left/top … left+bw/top+bh)', () => {
    const ks = rectKnots(b);
    expect(ks).toHaveLength(4);
    expect(ks[0].points.slice(2, 4)).toEqual([0, 0]);
    expect(ks[2].points.slice(2, 4)).toEqual([100, 100]);
  });
  test('ellipse: 4 Bézier-knot a fő-pontokon', () => {
    const ks = ellipseKnots(b);
    expect(ks).toHaveLength(4);
    // jobb pont anchorja (cx+rx, cy) = (100, 50)
    expect(ks[0].points[2]).toBeCloseTo(100);
    expect(ks[0].points[3]).toBeCloseTo(50);
  });
  test('star: 10 sarok (5 ág)', () => {
    expect(starKnots(b)).toHaveLength(10);
  });
  test('arrow: 7 sarok', () => {
    expect(arrowKnots(b)).toHaveLength(7);
  });
});

describe('shapeToVector — réteg → vektor-mezők', () => {
  test('zárt téglalap → vectorFill + vectorMask (nincs stroke border nélkül)', () => {
    const v = shapeToVector(
      { kind: 'shape', shape: 'rectangle', fill: '#00cc66', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5 },
      100,
      100,
    );
    expect(v.vectorFill).toEqual({ type: 'color', color: { r: 0, g: 204, b: 102 } });
    expect(v.vectorMask.paths[0].knots).toHaveLength(4);
    expect(v.vectorMask.paths[0].open).toBe(false);
    expect(v.vectorStroke).toBeUndefined();
  });
  test('téglalap + border → vectorStroke (px a vászon-magasságból)', () => {
    const v = shapeToVector(
      {
        kind: 'shape',
        shape: 'rectangle',
        fill: '#ffffff',
        borderColor: '#112233',
        borderWidth: 2, // 2% * 100 = 2px
        position: { x: 0.5, y: 0.5 },
        w: 0.5,
        h: 0.5,
      },
      100,
      100,
    );
    expect(v.vectorStroke.lineWidth).toEqual({ units: 'Pixels', value: 2 });
    expect(v.vectorStroke.content.color).toEqual({ r: 17, g: 34, b: 51 });
  });
  test('NYITOTT path → vectorStroke (fill a vonalszín), NINCS vectorFill', () => {
    const v = shapeToVector(
      {
        kind: 'shape',
        shape: 'path',
        fill: '#ff0000',
        closed: false,
        strokeWidth: 3,
        position: { x: 0.5, y: 0.5 },
        w: 1,
        h: 1,
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      },
      100,
      100,
    );
    expect(v.vectorFill).toBeUndefined();
    expect(v.vectorMask.paths[0].open).toBe(true);
    expect(v.vectorStroke.content.color).toEqual({ r: 255, g: 0, b: 0 });
    expect(v.vectorStroke.lineWidth.value).toBeCloseTo(3);
    expect(v.vectorStroke.fillEnabled).toBe(false);
  });
  test('összetett (subpaths) → több path, fillRule a modellből', () => {
    const v = shapeToVector(
      {
        kind: 'shape',
        shape: 'path',
        fill: '#000000',
        fillRule: 'evenodd',
        position: { x: 0.5, y: 0.5 },
        w: 1,
        h: 1,
        subpaths: [
          [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
          [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }],
        ],
      },
      100,
      100,
    );
    expect(v.vectorMask.paths).toHaveLength(2);
    expect(v.vectorMask.paths[0].fillRule).toBe('even-odd');
  });
  test('nem-vektorizálható (1-pontos path) → null (raszter-fallback)', () => {
    const v = shapeToVector(
      { kind: 'shape', shape: 'path', fill: '#000', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, points: [{ x: 0, y: 0 }] },
      100,
      100,
    );
    expect(v).toBeNull();
  });
  test('nem-shape réteg → null', () => {
    expect(shapeToVector({ kind: 'photo' }, 100, 100)).toBeNull();
  });
});

describe('ag-psd roundtrip-PRÓBA — az él-vektor PONTOSAN visszaolvasható', () => {
  test('writePsd(vectorMask+vectorFill+vectorStroke) → readPsd egyezik', () => {
    const W = 100;
    const H = 80;
    const psd = {
      width: W,
      height: H,
      children: [
        {
          name: 'Vec',
          left: 10,
          top: 10,
          right: 60,
          bottom: 50,
          vectorFill: { type: 'color', color: { r: 200, g: 50, b: 30 } },
          vectorStroke: {
            strokeEnabled: true,
            fillEnabled: true,
            lineWidth: { units: 'Pixels', value: 4 },
            lineCapType: 'round',
            lineJoinType: 'round',
            content: { type: 'color', color: { r: 0, g: 0, b: 255 } },
          },
          vectorMask: {
            paths: [
              {
                open: false,
                fillRule: 'non-zero',
                knots: [cornerKnot(10, 10), cornerKnot(60, 10), cornerKnot(60, 50), cornerKnot(10, 50)],
              },
            ],
          },
        },
      ],
    };
    const buf = Buffer.from(agPsd.writePsd(psd, { imageDataStyle: 'raw', generateThumbnail: false }));
    const read = agPsd.readPsd(buf, { useImageData: false, skipThumbnail: true });
    const L = read.children[0];
    // vektor-mask knot-ok pixelre pontosan
    expect(L.vectorMask.paths).toHaveLength(1);
    expect(L.vectorMask.paths[0].knots).toHaveLength(4);
    expect(L.vectorMask.paths[0].knots[2].points.map((v) => Math.round(v))).toEqual([60, 50, 60, 50, 60, 50]);
    // fill + stroke szín
    expect(L.vectorFill.color).toEqual({ r: 200, g: 50, b: 30 });
    expect(L.vectorStroke.content.color).toEqual({ r: 0, g: 0, b: 255 });
    expect(L.vectorStroke.lineWidth.value).toBeCloseTo(4);
  });

  test('ÍVES knot (eltérő fogók) roundtripje pontos', () => {
    const psd = {
      width: 100,
      height: 80,
      children: [
        {
          name: 'Curve',
          left: 0,
          top: 0,
          right: 100,
          bottom: 80,
          vectorFill: { type: 'color', color: { r: 1, g: 2, b: 3 } },
          vectorMask: {
            paths: [
              {
                open: false,
                fillRule: 'non-zero',
                knots: [
                  { linked: true, points: [5, 10, 10, 20, 15, 30] },
                  { linked: true, points: [40, 45, 50, 55, 60, 65] },
                ],
              },
            ],
          },
        },
      ],
    };
    const buf = Buffer.from(agPsd.writePsd(psd, { imageDataStyle: 'raw', generateThumbnail: false }));
    const read = agPsd.readPsd(buf, { useImageData: false, skipThumbnail: true });
    const k0 = read.children[0].vectorMask.paths[0].knots[0].points.map((v) => Math.round(v * 1000) / 1000);
    expect(k0).toEqual([5, 10, 10, 20, 15, 30]);
  });
});
