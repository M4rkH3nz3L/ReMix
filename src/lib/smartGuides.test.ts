import { snapToLayers } from '@/lib/smartGuides';

describe('smartGuides — igazodás-mag', () => {
  it('a vászon közepéhez pattan (0.5), ha közel van', () => {
    const r = snapToLayers({ x: 0.49, y: 0.49, w: 0.2, h: 0.2 }, []);
    expect(r.x).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.5);
    expect(r.lines).toEqual(expect.arrayContaining([{ axis: 'x', at: 0.5 }, { axis: 'y', at: 0.5 }]));
  });

  it('nem pattan, ha a küszöbön kívül van', () => {
    const r = snapToLayers({ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, [], 0.012);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.3);
    expect(r.lines).toEqual([]);
  });

  it('másik réteg KÖZÉPVONALÁHOZ igazít (center-to-center)', () => {
    const other = { x: 0.7, y: 0.2, w: 0.2, h: 0.2 };
    const r = snapToLayers({ x: 0.69, y: 0.8, w: 0.1, h: 0.1 }, [other]);
    expect(r.x).toBeCloseTo(0.7); // a közepe a másik közepéhez
    expect(r.lines.find((l) => l.axis === 'x')?.at).toBeCloseTo(0.7);
  });

  it('ÉL-igazítás: a mozgatott bal éle a másik bal éléhez', () => {
    // másik bal éle: 0.5 - 0.2/2 = 0.4; mozgatott bal éle = x - 0.1/2
    // ha x=0.451 → bal él 0.401 → a 0.4-hez pattan → x = 0.45
    const other = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const r = snapToLayers({ x: 0.451, y: 0.9, w: 0.1, h: 0.1 }, [other]);
    expect(r.x - 0.05).toBeCloseTo(0.4, 2); // a bal él (x - w/2) a másik bal éléhez (0.4) pattant
    expect(r.x).toBeCloseTo(0.45);
  });
});
