import {
  centeredPhotoLayer,
  defaultLayer,
  defaultShapeLayer,
  fullCanvasImageMask,
  lassoPolygonMask,
  paintedPhotoLayer,
  wandHighlightShape,
} from '@/lib/imageLayerDefaults';
import type { PhotoLayer } from '@/types/project';

describe('🧱 új rétegek alapértékei', () => {
  it('szöveg: a fordított felirat, Poppins, körvonalas preset, középen', () => {
    expect(defaultLayer('text', 't1', 'Szöveg')).toEqual({
      kind: 'text',
      id: 't1',
      text: 'Szöveg',
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 9,
      fontWeight: 'bold',
      fontFamily: 'Poppins',
      position: { x: 0.5, y: 0.5 },
      stylePreset: 'outline',
    });
  });
  it('kitöltés, korrekció, és minden más egy alap-téglalap', () => {
    expect(defaultLayer('fill', 'f', '')).toEqual({ kind: 'fill', id: 'f', fill: '#12121a' });
    expect(defaultLayer('adjust', 'a', '')).toEqual({ kind: 'adjust', id: 'a', adjust: {} });
    expect(defaultLayer('shape', 's', '')).toEqual({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.24, fill: '#ff2d95', cornerRadius: 0.12 });
  });
  it('formatípusok: vonal, téglalap, sokszög (6 oldal), ellipszis', () => {
    expect(defaultShapeLayer('line', 'l')).toEqual({ kind: 'shape', id: 'l', position: { x: 0.5, y: 0.5 }, fill: '#ffffff', shape: 'line', w: 0.6, h: 0.02, strokeWidth: 0.012 });
    expect(defaultShapeLayer('rectangle', 'r')).toMatchObject({ shape: 'rectangle', w: 0.4, h: 0.28, cornerRadius: 0.12, fill: '#ff2d95' });
    expect(defaultShapeLayer('polygon', 'p')).toMatchObject({ shape: 'polygon', w: 0.4, h: 0.4, sides: 6 });
    expect(defaultShapeLayer('ellipse', 'e')).not.toHaveProperty('sides');
  });
  it('fotó: középre, 0,7 × 0,5, cover; az assetId csak ha van (a kulcs-sorrend is a régi)', () => {
    expect(Object.keys(centeredPhotoLayer('p', 'file:///a.jpg'))).toEqual(['kind', 'id', 'uri', 'position', 'w', 'h', 'fit']);
    expect(Object.keys(centeredPhotoLayer('p', 'u', 'as1'))).toEqual(['kind', 'id', 'uri', 'assetId', 'position', 'w', 'h', 'fit']);
    expect(centeredPhotoLayer('p', 'u', 'as1')).toMatchObject({ assetId: 'as1', w: 0.7, h: 0.5, fit: 'cover' });
  });
  it('festett réteg: teljes vászon, contain, paint', () => {
    expect(paintedPhotoLayer('b', 'u')).toEqual({ kind: 'photo', id: 'b', uri: 'u', paint: true, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'contain' });
  });
  it('varázspálca-kiemelés: a forrás dobozán és transzformációján, félig átlátszó', () => {
    const src: PhotoLayer = { kind: 'photo', id: 'ph', uri: 'u', position: { x: 0.3, y: 0.4 }, w: 0.5, h: 0.6, fit: 'cover', rotation: 15, flipH: true };
    const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(wandHighlightShape('w', outline, src)).toEqual({
      kind: 'shape', id: 'w', shape: 'path', points: outline, closed: true, position: { x: 0.3, y: 0.4 }, w: 0.5, h: 0.6,
      rotation: 15, flipH: true, flipV: undefined, fill: '#7c5cff', opacity: 0.5,
    });
  });
  it('maszkok: teljes-vászon kép-maszk és lasszó-poligon bbox-szal', () => {
    expect(fullCanvasImageMask('m.png')).toEqual({ shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: 'm.png' });
    const m = lassoPolygonMask([{ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }]);
    expect(m).toMatchObject({ shape: 'polygon', feather: 0.02 });
    expect(m.w).toBeCloseTo(0.4);
    expect(m.h).toBeCloseTo(0.4);
    expect(m.x).toBeCloseTo(0.4);
    expect(m.y).toBeCloseTo(0.3);
    // a túl kicsi bbox legalább 0,02
    expect(lassoPolygonMask([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])).toMatchObject({ w: 0.02, h: 0.02 });
  });
});
