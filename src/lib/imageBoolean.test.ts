import { booleanCombineInDoc, canBoolean } from '@/lib/imageBoolean';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

const rect = (id: string, over: Partial<ShapeLayer> = {}): ShapeLayer =>
  ({
    kind: 'shape',
    id,
    shape: 'rectangle',
    position: { x: 0.5, y: 0.5 },
    w: 0.4,
    h: 0.4,
    fill: '#ff2d95',
    ...over,
  }) as ShapeLayer;

const photo = (id: string): ImageLayer =>
  ({ kind: 'photo', id, uri: 'file:///x.jpg', position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.3 }) as ImageLayer;

const doc = (layers: ImageLayer[]): ImageDoc =>
  ({ id: 'd', name: 'd', aspectRatio: '1:1', layers }) as unknown as ImageDoc;

describe('canBoolean — kell egy MÁSIK forma (07 §2.6)', () => {
  it('két forma → igaz', () => {
    expect(canBoolean(doc([rect('a'), rect('b')]), 'a')).toBe(true);
  });
  it('egyetlen forma (nincs pár) → hamis', () => {
    expect(canBoolean(doc([rect('a'), photo('p')]), 'a')).toBe(false);
  });
  it('a kijelölt nem forma / nincs kijelölés → hamis', () => {
    expect(canBoolean(doc([rect('a'), rect('b')]), 'p')).toBe(false);
    expect(canBoolean(doc([rect('a')]), null)).toBe(false);
    expect(canBoolean(null, 'a')).toBe(false);
  });
});

describe('booleanCombineInDoc — a két forma EGY path-formává olvad', () => {
  it('union: a result path-shape (subpaths+fillRule), a 2 forrás eltűnik', () => {
    const d = doc([
      rect('base', { position: { x: 0.4, y: 0.5 } }),
      rect('sel', { position: { x: 0.6, y: 0.5 } }),
      photo('p'),
    ]);
    const out = booleanCombineInDoc(d, 'sel', 'union');
    expect(out).not.toBeNull();
    const layers = out!.doc.layers;
    // a 2 forrás-forma (base, sel) helyett 1 eredmény + a photo marad
    expect(layers.find((l) => l.id === 'sel')).toBeUndefined();
    expect(layers.find((l) => l.id === 'base')).toBeUndefined();
    expect(layers.find((l) => l.id === 'p')).toBeDefined();
    const res = layers.find((l) => l.id === out!.resultId) as ShapeLayer;
    expect(res.shape).toBe('path');
    expect(res.subpaths?.length).toBeGreaterThan(0);
    expect(res.fillRule).toBe('nonzero');
    expect(out!.doc.renderedUri).toBeUndefined();
  });

  it('intersect két ÁTFEDŐ téglalapra → ad eredményt', () => {
    const d = doc([rect('a', { position: { x: 0.45, y: 0.5 } }), rect('b', { position: { x: 0.55, y: 0.5 } })]);
    const out = booleanCombineInDoc(d, 'b', 'intersect');
    expect(out).not.toBeNull();
    expect((out!.doc.layers.find((l) => l.id === out!.resultId) as ShapeLayer).shape).toBe('path');
  });

  it('nincs másik forma → null', () => {
    expect(booleanCombineInDoc(doc([rect('a'), photo('p')]), 'a', 'union')).toBeNull();
  });
});
