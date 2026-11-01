import { DEFAULT_BRUSH, EMPTY_HISTORY, hardnessSigma, isPaintLayer, pressureOf, pressureWidth, pushStroke, redoStroke, stabilize, strokeSegments, undoStroke, type Stroke } from '@/lib/brushEngine';

const stroke = (id: number): Stroke => ({ points: [{ x: id, y: 0, p: 1 }], color: '#000000', width: 0.1, hardness: 1, opacity: 1, eraser: false });

describe('nyomás', () => {
  it('ujjal (nincs adat) teljes szélesség', () => {
    expect(pressureOf(undefined)).toBe(1);
    expect(pressureOf(0)).toBe(1);
    expect(pressureOf(Number.NaN)).toBe(1);
    expect(pressureWidth(10, pressureOf(undefined))).toBe(10);
  });
  it('a nyomás arányosan vastagít, de sosem tűnik el a vonás', () => {
    expect(pressureOf(0.4)).toBeCloseTo(0.6);
    expect(pressureOf(1)).toBe(1);
    expect(pressureWidth(10, 0)).toBeCloseTo(2.5);
    expect(pressureWidth(10, 0.5)).toBeGreaterThan(pressureWidth(10, 0.2));
  });
});

describe('simítás', () => {
  const a = { x: 0, y: 0, p: 1 };
  const b = { x: 1, y: 1, p: 0 };
  it('0-nál a nyers pont, erősebben lemarad', () => {
    expect(stabilize(a, b, 0)).toEqual(b);
    expect(stabilize(a, b, 0.5).x).toBeLessThan(1);
    expect(stabilize(a, b, 1).x).toBeLessThan(stabilize(a, b, 0.5).x);
  });
});

describe('szakaszok', () => {
  it('egy pontból pötty lesz', () => {
    expect(strokeSegments({ points: [{ x: 0.5, y: 0.5, p: 1 }], width: 0.1 })).toEqual([{ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, width: 0.1 }]);
  });
  it('a szélesség a két végpont nyomását követi', () => {
    const s = strokeSegments({ points: [{ x: 0, y: 0, p: 0 }, { x: 1, y: 0, p: 1 }, { x: 2, y: 0, p: 1 }], width: 1 });
    expect(s).toHaveLength(2);
    expect(s[0].width).toBeLessThan(s[1].width);
  });
  it('üres vonásból nincs szakasz', () => {
    expect(strokeSegments({ points: [], width: 1 })).toEqual([]);
  });
});

describe('keménység', () => {
  it('éles vonásnál nincs elmosás, a lágyság a szélességgel nő', () => {
    expect(hardnessSigma(20, 1)).toBe(0);
    expect(hardnessSigma(20, 0)).toBeGreaterThan(hardnessSigma(20, 0.5));
    expect(hardnessSigma(40, 0)).toBeGreaterThan(hardnessSigma(20, 0));
  });
});

describe('vonásonkénti előzmény', () => {
  it('visszavon, újra megcsinál, új vonás után a redo elvész', () => {
    let h = pushStroke(pushStroke(EMPTY_HISTORY, stroke(1)), stroke(2));
    h = undoStroke(h);
    expect(h.done).toHaveLength(1);
    expect(h.undone).toHaveLength(1);
    h = redoStroke(h);
    expect(h.done.map((s) => s.points[0].x)).toEqual([1, 2]);
    h = pushStroke(undoStroke(h), stroke(3));
    expect(h.undone).toHaveLength(0);
    expect(redoStroke(h)).toBe(h);
  });
  it('üres veremből nincs mit visszavonni', () => {
    expect(undoStroke(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
  });
});

describe('festett réteg', () => {
  it('a jelző és a régi fájlnév is felismerhető, más fotó nem', () => {
    expect(isPaintLayer({ kind: 'photo', paint: true })).toBe(true);
    expect(isPaintLayer({ kind: 'photo', uri: 'file:///x/Projektek/a/brush_abc.png' })).toBe(true);
    expect(isPaintLayer({ kind: 'photo', uri: 'file:///x/photo.png' })).toBe(false);
    expect(isPaintLayer({ kind: 'text', paint: true })).toBe(false);
    expect(isPaintLayer(null)).toBe(false);
  });
});

it('az alapbeállítás éles, teljesen fedő ecset', () => {
  expect(DEFAULT_BRUSH).toMatchObject({ hardness: 1, opacity: 1, eraser: false });
});
