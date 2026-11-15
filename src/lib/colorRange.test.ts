import { colorRangeMask, colorRangeRings, maskToRings } from '@/lib/colorRange';
import { applyRing, type Selection, selectionContains } from '@/lib/selection';

/** w×h-s kép: a `paint(x,y)` színével (alfa 255) */
function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    px.set([r, g, b, 255], (y * w + x) * 4);
  }
  return px;
}
const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 30, 220];
const inSquare = (x: number, y: number, x0: number, y0: number, s: number) => x >= x0 && x < x0 + s && y >= y0 && y < y0 + s;
/** a gyűrűk mint kijelölés (a kép tere = a vászon), a műveletek sorrendjében */
const asSelection = (rings: ReturnType<typeof maskToRings>): Selection | null =>
  rings.reduce<Selection | null>((sel, r, i) => applyRing(sel, r.points, i === 0 ? 'new' : r.op, 0), null);

describe('🎯 S17: színtartomány-kijelölés', () => {
  it('két külön piros folt: mindkettő kijelölve (a varázspálca csak az egyiket adná)', () => {
    const px = image(100, 100, (x, y) => (inSquare(x, y, 10, 10, 20) || inSquare(x, y, 60, 60, 25) ? RED : BLUE));
    const rings = colorRangeRings(px, 100, 100, 15, 15, 40);
    expect(rings.filter((r) => r.op === 'add')).toHaveLength(2);
    const sel = asSelection(rings)!;
    expect(selectionContains(sel, { x: 0.2, y: 0.2 })).toBe(true);
    expect(selectionContains(sel, { x: 0.72, y: 0.72 })).toBe(true);
    expect(selectionContains(sel, { x: 0.5, y: 0.5 })).toBe(false);
  });

  it('lyuk és benne sziget: a sorrend (terület szerint) helyes kijelölést ad', () => {
    // piros keret (lyukas négyzet), a lyukban kék, a kék közepén piros sziget
    const px = image(100, 100, (x, y) => (inSquare(x, y, 10, 10, 80) && !inSquare(x, y, 30, 30, 40) ? RED : inSquare(x, y, 45, 45, 10) ? RED : BLUE));
    const rings = colorRangeRings(px, 100, 100, 12, 12, 40);
    expect(rings.map((r) => r.op)).toEqual(['add', 'subtract', 'add']);
    const sel = asSelection(rings)!;
    expect(selectionContains(sel, { x: 0.2, y: 0.5 })).toBe(true); // a keret
    expect(selectionContains(sel, { x: 0.35, y: 0.5 })).toBe(false); // a lyuk (kék)
    expect(selectionContains(sel, { x: 0.5, y: 0.5 })).toBe(true); // a sziget
  });

  it('a zaj (apró foltok) kimarad, a gyűrűk száma korlátos', () => {
    const px = image(100, 100, (x, y) => ((x * 7 + y * 13) % 29 === 0 ? RED : BLUE));
    const mask = colorRangeMask(px, 100, 100, RED, 40);
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
    expect(maskToRings(mask, 100, 100)).toHaveLength(0);
    const many = image(100, 100, (x, y) => (x % 10 < 4 && y % 10 < 4 ? RED : BLUE));
    expect(maskToRings(colorRangeMask(many, 100, 100, RED, 40), 100, 100, { maxRings: 20 })).toHaveLength(20);
  });

  it('az átlátszó képpont nem számít a színnek', () => {
    const px = image(10, 10, () => RED);
    px[3] = 0;
    expect(colorRangeMask(px, 10, 10, RED, 10)[0]).toBe(0);
    expect(colorRangeMask(px, 10, 10, RED, 10)[1]).toBe(1);
  });
});
