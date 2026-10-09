import {
  aspectCropRect,
  clampCropRect,
  cropImageDoc,
  FULL_CROP,
  moveCropRect,
  resizeCropCorner,
} from '@/lib/imageCrop';
import type { ImageDoc } from '@/types/project';

function doc(partial?: Partial<ImageDoc>): ImageDoc {
  return {
    id: 'd1',
    name: 'test',
    aspectRatio: '1:1',
    width: 1000,
    height: 1000,
    layers: [],
    ...partial,
  };
}

describe('clampCropRect', () => {
  it('a vászonba szorít és minimális méretet tart', () => {
    expect(clampCropRect({ x: -0.2, y: 0.5, w: 2, h: 0.6 })).toEqual({ x: 0, y: 0.4, w: 1, h: 0.6 });
  });
  it('a 0 méretet a minimumra emeli', () => {
    const r = clampCropRect({ x: 0.5, y: 0.5, w: 0, h: 0 }, 0.05);
    expect(r.w).toBe(0.05);
    expect(r.h).toBe(0.05);
    expect(r.x).toBeCloseTo(0.5);
  });
});

describe('moveCropRect', () => {
  it('mozgat, a méret marad, bent tart', () => {
    const r = moveCropRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 0.1, -0.1);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.4);
    expect(r.h).toBeCloseTo(0.4);
  });
  it('a szélére ütközve nem lóg ki', () => {
    const r = moveCropRect({ x: 0.7, y: 0.7, w: 0.4, h: 0.4 }, 0.5, 0.5);
    expect(r.x).toBeCloseTo(0.6);
    expect(r.y).toBeCloseTo(0.6);
  });
});

describe('resizeCropCorner', () => {
  it('br: a bal-felső sarok marad fix', () => {
    const r = resizeCropCorner({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'br', 0.1, 0.1);
    expect(r).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
  });
  it('tl: a jobb-alsó sarok marad fix', () => {
    const r = resizeCropCorner({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'tl', 0.1, 0.1);
    // jobb-alsó = 0.6,0.6 végig; az új bal-felső 0.3,0.3 → w=h=0.3
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.3);
    expect(r.x + r.w).toBeCloseTo(0.6);
    expect(r.y + r.h).toBeCloseTo(0.6);
  });
});

describe('aspectCropRect', () => {
  it('null → teljes vászon', () => {
    expect(aspectCropRect(doc(), null)).toEqual(FULL_CROP);
  });
  it('1:1 egy 16:9 vásznon → középre igazított négyzet (teljes magasság)', () => {
    const r = aspectCropRect(doc({ width: 1600, height: 900 }), 1);
    expect(r.h).toBeCloseTo(1);
    expect(r.w).toBeCloseTo(900 / 1600);
    // középen
    expect(r.x).toBeCloseTo((1 - 900 / 1600) / 2);
    expect(r.y).toBeCloseTo(0);
  });
  it('16:9 egy 1:1 vásznon → középre igazított, teljes szélesség', () => {
    const r = aspectCropRect(doc({ width: 1000, height: 1000 }), 16 / 9);
    expect(r.w).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(9 / 16);
    expect(r.y).toBeCloseTo((1 - 9 / 16) / 2);
  });
});

describe('cropImageDoc', () => {
  it('a teljes téglalapra vágva a doc változatlan (round-trip)', () => {
    const d = doc({
      layers: [
        { kind: 'shape', id: 's1', shape: 'rectangle', position: { x: 0.3, y: 0.7 }, w: 0.4, h: 0.2, fill: '#fff' },
      ],
    });
    const out = cropImageDoc(d, FULL_CROP);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(1000);
    const l = out.layers[0];
    expect(l.kind === 'shape' && l.position).toEqual({ x: 0.3, y: 0.7 });
    expect(l.kind === 'shape' && l.w).toBeCloseTo(0.4);
  });

  it('középső fél-kivágás: az új pixelméret feleződik, a középpont középen marad', () => {
    const d = doc({
      width: 1000,
      height: 1000,
      layers: [
        { kind: 'fill', id: 'bg', fill: '#000' },
        { kind: 'shape', id: 's1', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#fff' },
      ],
    });
    const out = cropImageDoc(d, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(out.width).toBe(500);
    expect(out.height).toBe(500);
    // a fill változatlan marad
    expect(out.layers[0]).toEqual({ kind: 'fill', id: 'bg', fill: '#000' });
    const s = out.layers[1];
    if (s.kind !== 'shape') throw new Error('shape várt');
    // a középpont (0.5,0.5) a kivágás közepén → marad (0.5,0.5)
    expect(s.position.x).toBeCloseTo(0.5);
    expect(s.position.y).toBeCloseTo(0.5);
    // a méret duplázódik (fele akkora vászon → kétszer akkora arány)
    expect(s.w).toBeCloseTo(0.8);
    expect(s.h).toBeCloseTo(0.8);
  });

  it('a kivágáson kívüli réteg negatív/1-en túli pozícióba kerül (megmarad, a vászon vágja)', () => {
    const d = doc({
      layers: [
        { kind: 'shape', id: 's1', shape: 'rectangle', position: { x: 0.1, y: 0.1 }, w: 0.1, h: 0.1, fill: '#fff' },
      ],
    });
    const out = cropImageDoc(d, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    const s = out.layers[0];
    if (s.kind !== 'shape') throw new Error('shape várt');
    // (0.1 - 0.5)/0.5 = -0.8
    expect(s.position.x).toBeCloseTo(-0.8);
    expect(s.position.y).toBeCloseTo(-0.8);
  });

  it('a betűméret a kivágás-magassággal skálázódik (px-azonosság)', () => {
    const d = doc({
      layers: [
        {
          kind: 'text',
          id: 't1',
          text: 'hi',
          color: '#fff',
          backgroundColor: null,
          fontSize: 10,
          fontWeight: 'bold',
          position: { x: 0.5, y: 0.5 },
        },
      ],
    });
    const out = cropImageDoc(d, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    const tl = out.layers[0];
    if (tl.kind !== 'text') throw new Error('text várt');
    expect(tl.fontSize).toBeCloseTo(20); // 10 / 0.5
  });

  it('a renderedUri cache érvénytelenítve', () => {
    const d = doc({ renderedUri: 'file://old.png' });
    expect(cropImageDoc(d, FULL_CROP).renderedUri).toBeUndefined();
  });
});
