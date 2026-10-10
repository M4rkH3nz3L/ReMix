import { floodFillMask, magicWandOutline, maskToPolygon, simplifyPolygon } from '@/lib/magicWand';

/** w×h RGBA kép egy háttér-színnel + opcionális kitöltött téglalappal */
function makeImg(
  w: number,
  h: number,
  bg: [number, number, number],
  rect?: { x: number; y: number; w: number; h: number; color: [number, number, number] }
): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * w + x) * 4;
        px[i] = rect.color[0];
        px[i + 1] = rect.color[1];
        px[i + 2] = rect.color[2];
        px[i + 3] = 255;
      }
    }
  }
  return px;
}

const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

describe('floodFillMask', () => {
  it('a magpixelhez hasonló ÖSSZEFÜGGŐ régiót jelöli (3×3 piros négyzet)', () => {
    const img = makeImg(5, 5, [255, 255, 255], { x: 1, y: 1, w: 3, h: 3, color: [255, 0, 0] });
    const mask = floodFillMask(img, 5, 5, 2, 2, 32);
    expect(count(mask)).toBe(9); // a 3×3 piros
    expect(mask[2 * 5 + 2]).toBe(1); // közép
    expect(mask[1 * 5 + 1]).toBe(1); // sarok
    expect(mask[0 * 5 + 0]).toBe(0); // fehér háttér — nem
  });

  it('a HÁTTÉRRE kattintva a háttér-régiót jelöli', () => {
    const img = makeImg(5, 5, [255, 255, 255], { x: 1, y: 1, w: 3, h: 3, color: [255, 0, 0] });
    const mask = floodFillMask(img, 5, 5, 0, 0, 32);
    expect(count(mask)).toBe(25 - 9); // minden, ami nem a piros négyzet
    expect(mask[0]).toBe(1);
    expect(mask[2 * 5 + 2]).toBe(0);
  });

  it('nagy tolerancia → minden (eltérő színek is összeolvadnak)', () => {
    const img = makeImg(4, 4, [255, 255, 255], { x: 0, y: 0, w: 2, h: 2, color: [200, 200, 200] });
    const mask = floodFillMask(img, 4, 4, 0, 0, 500);
    expect(count(mask)).toBe(16);
  });
});

describe('maskToPolygon', () => {
  it('egy 3×3 kitöltött négyzet határát követi (sarkokkal)', () => {
    const mask = new Uint8Array(25);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) mask[y * 5 + x] = 1;
    const poly = maskToPolygon(mask, 5, 5);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // minden pont a négyzet dobozán belül
    expect(poly.every((p) => p.x >= 1 && p.x <= 3 && p.y >= 1 && p.y <= 3)).toBe(true);
    // a 4 sarok a kontúron van
    expect(poly.some((p) => p.x === 1 && p.y === 1)).toBe(true);
    expect(poly.some((p) => p.x === 3 && p.y === 1)).toBe(true);
    expect(poly.some((p) => p.x === 3 && p.y === 3)).toBe(true);
    expect(poly.some((p) => p.x === 1 && p.y === 3)).toBe(true);
  });

  it('üres maszk → üres poligon', () => {
    expect(maskToPolygon(new Uint8Array(16), 4, 4)).toEqual([]);
  });
});

describe('simplifyPolygon', () => {
  it('a közeli pontokat eldobja (a távoliakat megtartja)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 }, // közeli → el
      { x: 5, y: 0 }, // távoli → marad
      { x: 5, y: 5 },
    ];
    const out = simplifyPolygon(pts, 1);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
  });
});

describe('magicWandOutline', () => {
  it('teljes lánc: 3×3 piros → normalizált (0–1) körvonal', () => {
    const img = makeImg(5, 5, [255, 255, 255], { x: 1, y: 1, w: 3, h: 3, color: [255, 0, 0] });
    const out = magicWandOutline(img, 5, 5, 2, 2, 32, 0.5);
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThanOrEqual(3);
    // 0–1 normalizált
    expect(out!.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    // a négyzet a vászon 0.2–0.6 tartományában van (1/5 … 3/5)
    expect(out!.some((p) => p.x >= 0.19 && p.x <= 0.61)).toBe(true);
  });

  it('egyszínű kép egy pixelre húzva se dobjon hibát (régió = minden)', () => {
    const img = makeImg(4, 4, [10, 20, 30]);
    const out = magicWandOutline(img, 4, 4, 1, 1, 10, 0.5);
    expect(out).not.toBeNull();
  });
});
