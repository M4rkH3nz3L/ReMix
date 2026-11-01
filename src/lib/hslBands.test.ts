import { computeHistogram, clipping, histogramCurve, histogramShift } from '@/lib/histogram';
import { bandWeights, isNeutralHsl, shiftColor } from '@/lib/hslBands';
import { layerOps, applyOps } from '@/lib/imagePixelPipeline';
import type { PhotoLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const worker = require('../../server/hslBands');

const red: [number, number, number] = [0.9, 0.1, 0.1];
const blue: [number, number, number] = [0.1, 0.2, 0.9];

describe('sávok', () => {
  it('a súlyok összege mindig 1, a sáv közepén csak ő hat', () => {
    for (let h = -30; h < 400; h += 7) {
      expect(bandWeights(h).reduce((s, v) => s + v, 0)).toBeCloseTo(1);
    }
    expect(bandWeights(120)[3]).toBeCloseTo(1);
    expect(bandWeights(350)[0]).toBeGreaterThan(0.7);
    expect(bandWeights(350)[7]).toBeGreaterThan(0);
  });
  it('a semleges beállítás felismerhető', () => {
    expect(isNeutralHsl(undefined)).toBe(true);
    expect(isNeutralHsl({ red: { h: 0, s: 0, l: 0 } })).toBe(true);
    expect(isNeutralHsl({ red: { s: -1 } })).toBe(false);
  });
});

describe('eltolás', () => {
  it('csak a kért szín változik', () => {
    const hsl = { red: { s: -1 } };
    const [r, g] = shiftColor(...red, hsl);
    expect(Math.abs(r - g)).toBeLessThan(0.01);
    expect(shiftColor(...blue, hsl).map((v) => Number(v.toFixed(3)))).toEqual(blue.map((v) => Number(v.toFixed(3))));
  });
  it('a szürke érintetlen, a világosság sem mozdítja', () => {
    expect(shiftColor(0.5, 0.5, 0.5, { red: { l: 1 }, blue: { h: 1 } })).toEqual([0.5, 0.5, 0.5]);
  });
  it('árnyalat: a piros a sárga felé megy', () => {
    const [, g] = shiftColor(...red, { red: { h: 1 } });
    expect(g).toBeGreaterThan(0.4);
  });
  it('világosság: a kék világosodik', () => {
    const a = shiftColor(...blue, { blue: { l: 1 } });
    expect(a[0] + a[1] + a[2]).toBeGreaterThan(blue[0] + blue[1] + blue[2] + 0.3);
  });
});

describe('kliens = worker', () => {
  it('a két képlet egyezik a teljes színtérben', () => {
    const hsl = { red: { h: 0.6, s: -0.4, l: 0.3 }, green: { h: -1, s: 1 }, aqua: { l: -1 }, magenta: { h: 0.5, s: 0.5 } };
    for (let r = 0; r <= 1; r += 0.1) for (let g = 0; g <= 1; g += 0.1) for (let b = 0; b <= 1; b += 0.1) {
      const c = shiftColor(r, g, b, hsl);
      const w = worker.shiftColor(r, g, b, hsl);
      c.forEach((v, i) => expect(v).toBeCloseTo(w[i], 8));
    }
  });
  it('a lánc a korrekció után futtatja', () => {
    const layer = { hsl: { red: { s: -1 } } } as unknown as PhotoLayer;
    const [r, g] = applyOps(layerOps(layer), red);
    expect(Math.abs(r - g)).toBeLessThan(0.01);
  });
  it('a .cube a kért méretű és soros', () => {
    const rows = worker.hslCube({ red: { s: -1 } }, 3).split('\n');
    expect(rows[0]).toBe('LUT_3D_SIZE 3');
    expect(rows).toHaveLength(1 + 27);
  });
});

describe('hisztogram', () => {
  const px = (...c: number[][]) => new Uint8Array(c.flat());
  it('rekeszbe rak, az átlátszót kihagyja', () => {
    const h = computeHistogram(px([255, 0, 0, 255], [0, 0, 0, 255], [9, 9, 9, 0]));
    expect(h.total).toBe(2);
    expect(h.r[255]).toBe(1);
    expect(h.l[0]).toBe(1);
  });
  it('a színleképezés a szerkesztett értéket számolja', () => {
    const h = computeHistogram(px([100, 100, 100, 255]), ([r]) => [r / 2, r / 2, r / 2]);
    expect(h.r[50]).toBe(1);
  });
  it('jelzi a kiégést és a beégést', () => {
    const c = clipping(computeHistogram(px([255, 255, 255, 255], [0, 0, 0, 255], [9, 9, 9, 255], [90, 90, 90, 255])));
    expect(c).toEqual({ shadows: 0.25, highlights: 0.25 });
  });
  it('a távolság szintben mér: azonosra 0, egy tüske elcsúszása annyi, amennyit mozdult', () => {
    const a = computeHistogram(px([100, 100, 100, 255]));
    expect(histogramShift(a.l, a.l)).toBe(0);
    expect(histogramShift(a.l, computeHistogram(px([103, 103, 103, 255])).l)).toBeCloseTo(3);
    expect(histogramShift(a.l, computeHistogram(px([200, 200, 200, 255])).l)).toBeCloseTo(100);
  });
  it('a görbe 0–1 közti, a csúcs nem nyomja le a többit', () => {
    const bins = new Uint32Array(256).fill(10);
    bins[5] = 100000;
    const c = histogramCurve(bins);
    expect(Math.max(...c)).toBe(1);
    expect(c[100]).toBeGreaterThan(0.5);
  });
});
