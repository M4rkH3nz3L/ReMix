import { alignLayerInDoc, alignLayerToCanvas, canAlignLayer, layerRect } from '@/lib/imageLayerLayout';
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
