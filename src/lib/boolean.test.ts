import { booleanShapes, divideShapes, flattenShape } from '@/lib/boolean';
import type { ShapeClip } from '@/types/project';

// 🔗 Vektor-forma boolean (union/subtract/intersect/exclude; a preview ÉS a
// render közös magja) regressziós pajzsa. Pure geometria → tesztelhető.

const rect = (x: number, y: number, w: number, h: number): ShapeClip =>
  ({
    id: `s-${x}-${y}`, kind: 'shape', shape: 'rectangle', start: 0, duration: 5,
    position: { x, y }, w, h, fill: '#fff',
  } as ShapeClip);

describe('flattenShape — forma → vászon-poligon', () => {
  it('téglalap → a doboz 4 sarka', () => {
    expect(flattenShape(rect(0.5, 0.5, 0.4, 0.4))).toEqual([
      { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 },
    ]);
  });
  it('ellipszis → 48 kerület-pont', () => {
    expect(flattenShape({ ...rect(0.5, 0.5, 0.4, 0.4), shape: 'ellipse' } as ShapeClip)).toHaveLength(48);
  });
  it('nyíl → a 7-csúcsú egység-poligon leképezve', () => {
    expect(flattenShape({ ...rect(0.5, 0.5, 1, 1), shape: 'arrow' } as ShapeClip)).toHaveLength(7);
  });
});

describe('booleanShapes — a négy művelet kimenete', () => {
  const a = rect(0.5, 0.5, 0.4, 0.4); // x 0.3..0.7
  const bOverlap = rect(0.6, 0.6, 0.4, 0.4); // x 0.4..0.8 → fed
  const bFar = rect(0.9, 0.9, 0.1, 0.1); // nincs átfedés

  it('union → mindkét subpath, nonzero', () => {
    const r = booleanShapes(a, bOverlap, 'union')!;
    expect(r.fillRule).toBe('nonzero');
    expect(r.subpaths).toHaveLength(2);
  });

  it('exclude → [a, b] evenodd', () => {
    const r = booleanShapes(a, bOverlap, 'exclude')!;
    expect(r.fillRule).toBe('evenodd');
    expect(r.subpaths).toHaveLength(2);
  });

  it('intersect (átfedő) → egy levágott poligon', () => {
    const r = booleanShapes(a, bOverlap, 'intersect')!;
    expect(r.subpaths).toHaveLength(1);
    expect(r.subpaths[0].length).toBeGreaterThanOrEqual(3);
    expect(r.fillRule).toBe('nonzero');
  });

  it('intersect (nem átfedő) → null', () => {
    expect(booleanShapes(a, bFar, 'intersect')).toBeNull();
  });

  it('subtract (átfedő) → a + lyuk (2 subpath), nonzero', () => {
    const r = booleanShapes(a, bOverlap, 'subtract')!;
    expect(r.fillRule).toBe('nonzero');
    expect(r.subpaths).toHaveLength(2); // a külső + a lyuk
  });

  it('subtract (nem átfedő) → csak a (nincs lyuk)', () => {
    const r = booleanShapes(a, bFar, 'subtract')!;
    expect(r.subpaths).toHaveLength(1);
  });
});

describe('divideShapes — átfedő formák külön régiókra (Pathfinder divide)', () => {
  const a = rect(0.5, 0.5, 0.4, 0.4); // x 0.3..0.7
  const bOverlap = rect(0.6, 0.6, 0.4, 0.4); // fed
  const bFar = rect(0.9, 0.9, 0.1, 0.1); // nincs átfedés

  it('átfedő → 3 lap: A∖B, B∖A, A∩B (forrás-tagekkel)', () => {
    const faces = divideShapes(a, bOverlap);
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.source)).toEqual(['a', 'b', 'ab']);
    expect(faces.every((f) => f.subpaths.length >= 1)).toBe(true);
  });

  it('nem átfedő → 2 egész forma (A, B)', () => {
    const faces = divideShapes(a, bFar);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => f.source)).toEqual(['a', 'b']);
  });

  it('teljes átfedés (azonos forma) → kezeli, nem dob; van átfedés-lap', () => {
    const faces = divideShapes(a, { ...a, id: 'a2' } as ShapeClip);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.some((f) => f.source === 'ab')).toBe(true);
  });
});
