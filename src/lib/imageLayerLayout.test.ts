import {
  alignLayerInDoc,
  alignLayersInDoc,
  distributeSelectedInDoc,
  alignLayerToCanvas,
  canAlignLayer,
  distributeLayersInDoc,
  layerRect,
  positionedLayerCount,
} from '@/lib/imageLayerLayout';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

const photo = (over: Partial<PhotoLayer> = {}): PhotoLayer =>
  ({
    kind: 'photo',
    id: 'p',
    uri: 'file:///x.jpg',
    position: { x: 0.5, y: 0.5 },
    w: 0.4,
    h: 0.2,
    ...over,
  }) as PhotoLayer;

const fill = (): ImageLayer => ({ kind: 'fill', id: 'f', fill: '#000' }) as ImageLayer;

const doc = (layers: ImageLayer[]): ImageDoc =>
  ({ id: 'd', name: 'd', aspectRatio: '1:1', layers }) as unknown as ImageDoc;

describe('layerRect — réteg → befoglaló Rect', () => {
  it('középpont + méret → bal-felső + méret', () => {
    expect(layerRect(photo({ position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.2 }))).toEqual({
      x: 0.3,
      y: 0.4,
      width: 0.4,
      height: 0.2,
    });
  });
  it('fill (nincs pozíció) → null', () => {
    expect(layerRect(fill())).toBeNull();
  });
});

describe('alignLayerToCanvas — vászonhoz igazítás (07 §2.7)', () => {
  it('bal: a bal él a vászon bal szélére (x = w/2), y változatlan', () => {
    const l = alignLayerToCanvas(photo({ position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.2 }), 'left') as PhotoLayer;
    expect(l.position.x).toBeCloseTo(0.2); // 0 + w/2
    expect(l.position.y).toBeCloseTo(0.5); // érintetlen
  });
  it('hcenter: középre (x = 0.5)', () => {
    const l = alignLayerToCanvas(photo({ position: { x: 0.1, y: 0.3 }, w: 0.4, h: 0.2 }), 'hcenter') as PhotoLayer;
    expect(l.position.x).toBeCloseTo(0.5);
  });
  it('right: a jobb él a vászon jobb szélére (x = 1 - w/2)', () => {
    const l = alignLayerToCanvas(photo({ w: 0.4 }), 'right') as PhotoLayer;
    expect(l.position.x).toBeCloseTo(0.8);
  });
  it('bottom: az alsó él a vászon aljára (y = 1 - h/2)', () => {
    const l = alignLayerToCanvas(photo({ h: 0.2 }), 'bottom') as PhotoLayer;
    expect(l.position.y).toBeCloseTo(0.9);
  });
  it('no-op: már igazított réteg → UGYANAZ a referencia', () => {
    const l = photo({ position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.2 });
    expect(alignLayerToCanvas(l, 'hcenter')).toBe(l);
  });
  it('fill-réteget nem mozgat', () => {
    const f = fill();
    expect(alignLayerToCanvas(f, 'left')).toBe(f);
  });
});

describe('alignLayerInDoc / canAlignLayer', () => {
  it('a doc megfelelő rétegét igazítja + a render-cache-t üríti', () => {
    const d = { ...doc([photo({ id: 'p', position: { x: 0.1, y: 0.5 }, w: 0.4, h: 0.2 })]), renderedUri: 'cache.png' } as ImageDoc;
    const next = alignLayerInDoc(d, 'p', 'hcenter');
    expect((next.layers[0] as PhotoLayer).position.x).toBeCloseTo(0.5);
    expect(next.renderedUri).toBeUndefined();
  });
  it('ismeretlen/no-op réteg → UGYANAZ a doc-referencia', () => {
    const d = doc([photo({ id: 'p' })]);
    expect(alignLayerInDoc(d, 'nincs', 'left')).toBe(d);
  });
  it('canAlignLayer: pozíciós réteg igen, fill/null nem', () => {
    expect(canAlignLayer(photo())).toBe(true);
    expect(canAlignLayer(fill())).toBe(false);
    expect(canAlignLayer(null)).toBe(false);
  });
});

describe('distributeLayersInDoc / positionedLayerCount (07 §2.7)', () => {
  it('positionedLayerCount: csak a pozícionált rétegeket számolja (fill kimarad)', () => {
    expect(positionedLayerCount(doc([photo({ id: 'a' }), fill(), photo({ id: 'b' })]))).toBe(2);
  });

  it('3 réteg vízszintes elosztása → egyenlő rések (a szélsők maradnak)', () => {
    const d = doc([
      photo({ id: 'a', position: { x: 0.1, y: 0.5 }, w: 0.1, h: 0.1 }),
      photo({ id: 'b', position: { x: 0.15, y: 0.5 }, w: 0.1, h: 0.1 }), // közel az 'a'-hoz
      photo({ id: 'c', position: { x: 0.9, y: 0.5 }, w: 0.1, h: 0.1 }),
    ]);
    const next = distributeLayersInDoc(d, 'horizontal');
    const xs = (next.layers as PhotoLayer[]).map((l) => l.position.x);
    // a szélsők (0.1 és 0.9) maradnak, a középső kiegyenlítődik
    expect(xs[0]).toBeCloseTo(0.1);
    expect(xs[2]).toBeCloseTo(0.9);
    expect(xs[1]).toBeGreaterThan(0.15); // elmozdult a középre
    expect(next.renderedUri).toBeUndefined();
  });

  it('<3 pozícionált réteg → no-op (ugyanaz a referencia)', () => {
    const d = doc([photo({ id: 'a' }), photo({ id: 'b' })]);
    expect(distributeLayersInDoc(d, 'horizontal')).toBe(d);
  });
});

describe('alignLayersInDoc — KIJELÖLT rétegek egymáshoz (nem vászonhoz)', () => {
  const L = (id: string, x: number, y: number): ImageLayer =>
    ({ kind: 'photo', id, uri: 'file:///x.jpg', position: { x, y }, w: 0.2, h: 0.2 }) as ImageLayer;

  it('left: a kijelöltek bal-éle a közös bbox bal-széléhez igazodik', () => {
    const d = doc([L('a', 0.3, 0.2), L('b', 0.6, 0.5), L('c', 0.9, 0.8)]);
    const out = alignLayersInDoc(d, ['a', 'b', 'c'], 'left');
    const xs = out.layers.map((l) => (l as { position: { x: number } }).position.x);
    // a legbaloldalibb bal-éle = 0.3 - 0.1 = 0.2 → közép = 0.2 + 0.1 = 0.3
    expect(xs).toEqual([0.3, 0.3, 0.3]);
  });

  it('csak a kijelölteket mozgatja (a ki nem jelölt marad)', () => {
    const d = doc([L('a', 0.3, 0.5), L('b', 0.7, 0.5), L('keep', 0.9, 0.9)]);
    const out = alignLayersInDoc(d, ['a', 'b'], 'left');
    expect((out.layers.find((l) => l.id === 'keep') as { position: { x: number } }).position.x).toBe(0.9);
    expect(out.renderedUri).toBeUndefined();
  });

  it('<2 kijelölt → no-op (eredeti referencia)', () => {
    const d = doc([L('a', 0.3, 0.5), L('b', 0.7, 0.5)]);
    expect(alignLayersInDoc(d, ['a'], 'left')).toBe(d);
  });
});

describe('distributeSelectedInDoc — CSAK a kijelöltek rés-elosztása', () => {
  const L = (id: string, x: number): ImageLayer =>
    ({ kind: 'photo', id, uri: 'file:///x.jpg', position: { x, y: 0.5 }, w: 0.1, h: 0.1 }) as ImageLayer;

  it('3 kijelölt → a középső a szélsők közé egyenlő réssel', () => {
    const d = doc([L('a', 0.2), L('mid', 0.4), L('c', 0.8), L('skip', 0.95)]);
    const out = distributeSelectedInDoc(d, ['a', 'mid', 'c'], 'horizontal');
    const midX = (out.layers.find((l) => l.id === 'mid') as { position: { x: number } }).position.x;
    // a..c span 0.2..0.8 (szélek), 3×0.1 méret → gap=(0.6-0.3)/2=0.15; mid közép = 0.15(bal)+0.1+0.15+0.05=0.5
    expect(midX).toBeCloseTo(0.5, 6);
    // a skip nem mozdul
    expect((out.layers.find((l) => l.id === 'skip') as { position: { x: number } }).position.x).toBe(0.95);
  });

  it('<3 kijelölt → no-op', () => {
    const d = doc([L('a', 0.2), L('b', 0.8)]);
    expect(distributeSelectedInDoc(d, ['a', 'b'], 'horizontal')).toBe(d);
  });
});
