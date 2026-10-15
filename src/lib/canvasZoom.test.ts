import { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomStep, clampPan, canvasTransform } from '@/lib/canvasZoom';

describe('canvasZoom — vászon-zoom/pan mag', () => {
  it('clampZoom: a [MIN,MAX] tartományba szorít + kerekít', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(999)).toBe(ZOOM_MAX);
    expect(clampZoom(2.345)).toBe(2.35);
    expect(clampZoom(NaN)).toBe(ZOOM_MIN);
  });

  it('zoomStep: ×1.5 / ÷1.5, határokba szorítva', () => {
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(1.5, 1)).toBe(2.25);
    expect(zoomStep(1, -1)).toBe(ZOOM_MIN); // nem megy 1 alá
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX); // nem megy MAX fölé
    expect(zoomStep(2.25, -1)).toBe(1.5);
  });

  it('clampPan: zoom=1 → {0,0}; zoom>1 → ±(box·(z-1)/2) határ', () => {
    expect(clampPan({ x: 50, y: 50 }, 1, { w: 100, h: 100 })).toEqual({ x: 0, y: 0 });
    // zoom=2, box=100 → max ±50
    expect(clampPan({ x: 80, y: -80 }, 2, { w: 100, h: 100 })).toEqual({ x: 50, y: -50 });
    expect(clampPan({ x: 10, y: -20 }, 2, { w: 100, h: 100 })).toEqual({ x: 10, y: -20 });
  });

  it('canvasTransform: a pan-t a zoomhoz/kerethez igazítja', () => {
    expect(canvasTransform(1, { x: 99, y: 99 }, { w: 200, h: 200 })).toEqual({ translateX: 0, translateY: 0, scale: 1 });
    expect(canvasTransform(3, { x: 1000, y: 0 }, { w: 200, h: 200 })).toEqual({ translateX: 200, translateY: 0, scale: 3 }); // max 200·(3-1)/2=200
  });
});
