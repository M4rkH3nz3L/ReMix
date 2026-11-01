import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { duplicateLayers, layerAtPoint, removeLayers, stageToCanvas, toggleId } from '@/lib/imageMulti';
import type { ImageDoc, ImageLayer } from '@/types/project';

const base = (width = 1000, height = 1000): ImageDoc => {
  let n = 0;
  return createImageDoc('t', '1:1', () => `b${++n}`, { width, height });
};
const shape = (id: string, x: number, y: number, extra: object = {}) =>
  ({ kind: 'shape', id, shape: 'rectangle', position: { x, y }, w: 0.2, h: 0.2, fill: '#fff', ...extra }) as ImageLayer;

describe('layerAtPoint', () => {
  it('a felső réteg nyer', () => {
    const doc = addLayer(addLayer(base(), shape('a', 0.5, 0.5)), shape('b', 0.55, 0.5));
    expect(layerAtPoint(doc, 0.56, 0.5)?.id).toBe('b');
    expect(layerAtPoint(doc, 0.42, 0.5)?.id).toBe('a');
  });

  it('a háttér nem menüelem, üres helyen nincs találat', () => {
    expect(layerAtPoint(base(), 0.5, 0.5)).toBeNull();
    expect(layerAtPoint(addLayer(base(), shape('a', 0.2, 0.2)), 0.9, 0.9)).toBeNull();
  });

  it('a rejtett és a zárolt réteget átlépi', () => {
    const doc = addLayer(addLayer(addLayer(base(), shape('a', 0.5, 0.5)), shape('h', 0.5, 0.5, { hidden: true })), shape('l', 0.5, 0.5, { locked: true }));
    expect(layerAtPoint(doc, 0.5, 0.5)?.id).toBe('a');
  });

  it('a forgatott réteget a valódi alakján találja el', () => {
    const doc = addLayer(base(), shape('a', 0.5, 0.5, { w: 0.4, h: 0.1, rotation: 90 }));
    expect(layerAtPoint(doc, 0.5, 0.65)?.id).toBe('a');
    expect(layerAtPoint(doc, 0.65, 0.5)).toBeNull();
  });

  it('nem négyzet vásznon is helyes a forgatás', () => {
    const doc = addLayer(base(2000, 1000), shape('a', 0.5, 0.5, { w: 0.2, h: 0.1, rotation: 90 }));
    // 400×100 px álló helyzetben: függőlegesen 200 px = 0,2 a középtől
    expect(layerAtPoint(doc, 0.5, 0.68)?.id).toBe('a');
    expect(layerAtPoint(doc, 0.6, 0.5)).toBeNull();
  });

  it('a szöveg a becsült dobozával található el', () => {
    const doc = addLayer(base(), { kind: 'text', id: 't', text: 'Hello', position: { x: 0.5, y: 0.5 }, fontSize: 10, color: '#fff' } as ImageLayer);
    expect(layerAtPoint(doc, 0.5, 0.5)?.id).toBe('t');
    expect(layerAtPoint(doc, 0.5, 0.7)).toBeNull();
  });
});

describe('stageToCanvas', () => {
  const stage = { w: 400, h: 600 };
  const box = { w: 300, h: 300 };
  it('a középpont a vászon közepe', () => {
    expect(stageToCanvas(200, 300, stage, box, { translateX: 0, translateY: 0, scale: 1 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('nagyítva és eltolva is a pont alatti helyet adja', () => {
    expect(stageToCanvas(350, 300, stage, box, { translateX: 0, translateY: 0, scale: 2 }).x).toBeCloseTo(0.75);
    expect(stageToCanvas(250, 300, stage, box, { translateX: 50, translateY: 0, scale: 1 }).x).toBeCloseTo(0.5);
  });
});

describe('több réteg', () => {
  const doc = addLayer(addLayer(addLayer(base(), shape('a', 0.2, 0.2)), shape('b', 0.5, 0.5)), shape('c', 0.8, 0.8));
  it('toggleId hozzáad és elvesz', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('törlés együtt', () => {
    expect(removeLayers(doc, ['a', 'c']).layers.map((l) => l.id)).toContain('b');
    expect(removeLayers(doc, ['a', 'c']).layers).toHaveLength(2);
  });

  it('másolás együtt', () => {
    let n = 0;
    expect(duplicateLayers(doc, ['a', 'b'], () => `d${++n}`).layers).toHaveLength(6);
  });
});
