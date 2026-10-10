import { pathShapeFromCanvasPoints } from '@/lib/penPath';

describe('pathShapeFromCanvasPoints', () => {
  it('< 2 pont → null', () => {
    expect(pathShapeFromCanvasPoints([], false, 'p1')).toBeNull();
    expect(pathShapeFromCanvasPoints([{ x: 0.5, y: 0.5 }], false, 'p1')).toBeNull();
  });

  it('háromszög (zárt) → path-forma a befoglaló dobozzal + lokális 0–1 pontok', () => {
    const tri = [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.4, y: 0.8 },
    ];
    const s = pathShapeFromCanvasPoints(tri, true, 'p1', '#fff');
    if (!s) throw new Error('shape várt');
    expect(s.shape).toBe('path');
    expect(s.closed).toBe(true);
    // bbox: x 0.2..0.6 (w=0.4), y 0.2..0.8 (h=0.6)
    expect(s.w).toBeCloseTo(0.4);
    expect(s.h).toBeCloseTo(0.6);
    // középpont = bbox közepe
    expect(s.position.x).toBeCloseTo(0.4);
    expect(s.position.y).toBeCloseTo(0.5);
    // lokális pontok a dobozra 0–1: (0.2,0.2)→(0,0), (0.6,0.2)→(1,0), (0.4,0.8)→(0.5,1)
    expect(s.points?.[0]).toMatchObject({ x: 0, y: 0 });
    expect(s.points?.[1].x).toBeCloseTo(1);
    expect(s.points?.[1].y).toBeCloseTo(0);
    expect(s.points?.[2].x).toBeCloseTo(0.5);
    expect(s.points?.[2].y).toBeCloseTo(1);
    // zárt → nincs kényszerített strokeWidth (kitöltött)
    expect(s.strokeWidth).toBeUndefined();
  });

  it('nyitott path → van látható vonalvastagság', () => {
    const s = pathShapeFromCanvasPoints(
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      false,
      'p2'
    );
    if (!s) throw new Error('shape várt');
    expect(s.closed).toBe(false);
    expect(s.strokeWidth).toBeGreaterThan(0);
    // vízszintes vonal: h degenerált → min 0.02-re emelve (ne tűnjön el)
    expect(s.h).toBeCloseTo(0.02);
    expect(s.w).toBeCloseTo(0.8);
  });
});
