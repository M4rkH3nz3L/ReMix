import { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomStep, pinchAt, pinchZoom, clampPan, canvasTransform } from '@/lib/canvasZoom';

describe('canvasZoom — vászon-zoom/pan mag', () => {
  it('clampZoom: a [MIN,MAX] tartományba szorít + kerekít', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(999)).toBe(ZOOM_MAX);
    expect(clampZoom(2.345)).toBe(2.35);
    expect(clampZoom(NaN)).toBe(1);
  });

  it('zoomStep: ×1.5 / ÷1.5, határokba szorítva', () => {
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(1.5, 1)).toBe(2.25);
    expect(zoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN); // nem megy a minimum alá
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX); // nem megy MAX fölé
    expect(zoomStep(2.25, -1)).toBe(1.5);
  });

  it('pinchZoom: startZoom × scale, határokba szorítva', () => {
    expect(pinchZoom(1, 2)).toBe(2); // 1× kezdet, 2× csippentés → 2
    expect(pinchZoom(2, 1.5)).toBe(3); // 2× kezdet, 1,5× → 3
    expect(pinchZoom(ZOOM_MIN, 0.5)).toBe(ZOOM_MIN); // nem megy a minimum alá
    expect(pinchZoom(5, 3)).toBe(ZOOM_MAX); // nem megy MAX fölé
    expect(pinchZoom(2, 1)).toBe(2); // scale=1 → változatlan
    expect(pinchZoom(2, 0)).toBe(2); // érvénytelen scale → a kezdő zoom
    expect(pinchZoom(NaN, 2)).toBe(2); // érvénytelen startZoom → 1×scale
  });

  it('clampPan: a vászon nem veszhet el a nézetből', () => {
    const box = { w: 200, h: 100 };
    expect(clampPan({ x: 9999, y: -9999 }, 1, box)).toEqual({ x: 150, y: -75 });
    expect(clampPan({ x: 9999, y: 0 }, 2, box)).toEqual({ x: 250, y: 0 });
    expect(clampPan({ x: 10, y: 5 }, 0.5, box)).toEqual({ x: 10, y: 5 }); // kicsinyítve is tolható
  });

  it('canvasTransform: a zoomot és a pant adja, 1×-en sem nulláz', () => {
    expect(canvasTransform(2, { x: 10, y: 20 }, { w: 100, h: 100 })).toEqual({ translateX: 10, translateY: 20, scale: 2 });
    expect(canvasTransform(1, { x: 10, y: 0 }, { w: 100, h: 100 }).translateX).toBe(10);
  });

  it('pinchAt: az ujjak alatti pont helyben marad', () => {
    const box = { w: 300, h: 300 };
    const start = { zoom: 1, pan: { x: 0, y: 0 }, focal: { x: 100, y: 50 } };
    const r = pinchAt(start, 2, start.focal, box);
    expect(r.zoom).toBe(2);
    // a fókusz alatti tartalom-pont: (focal − pan) / zoom változatlan
    expect((start.focal.x - r.pan.x) / r.zoom).toBeCloseTo(100);
    expect((start.focal.y - r.pan.y) / r.zoom).toBeCloseTo(50);
  });
  it('pinchAt: a két ujj együttes mozgása tolja a nézetet', () => {
    const start = { zoom: 2, pan: { x: 0, y: 0 }, focal: { x: 0, y: 0 } };
    expect(pinchAt(start, 1, { x: 30, y: -20 }, { w: 300, h: 300 }).pan).toEqual({ x: 30, y: -20 });
  });
});
