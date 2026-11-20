import { BLENDS, CAPS, DASHES, defaultBorderAlign, JOINS, SHAPES, TEXT_ALIGNS } from '@/lib/layerInspectorOps';
import type { ShapeLayer } from '@/types/project';

const shape = (s: ShapeLayer['shape']) => ({ kind: 'shape', id: 's', shape: s, x: 0.5, y: 0.5, w: 0.2, h: 0.2, fill: '#fff' }) as unknown as ShapeLayer;

describe('layerInspectorOps — a réteg-inspektor opció-listái', () => {
  it('a keverési módok sorrendje: a normal elöl, utána a 11 ffmpeg-blend', () => {
    expect(BLENDS).toEqual([
      'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'softlight', 'hardlight', 'difference', 'exclusion', 'colordodge', 'colorburn',
    ]);
  });

  it('a forma-választó a path-ot NEM kínálja (azt a toll hozza létre)', () => {
    expect(SHAPES).toEqual(['rectangle', 'ellipse', 'line', 'arrow', 'star', 'polygon']);
    expect(SHAPES).not.toContain('path');
  });

  it('szöveg-igazítás, vonal-stílus, vonalvég és csatlakozás — érték és sorrend', () => {
    expect(TEXT_ALIGNS.map((a) => a.key)).toEqual(['left', 'center', 'right', 'justify']);
    expect(DASHES).toEqual([
      { value: 0, labelKey: 'studio.image.stroke.solid' },
      { value: 1, labelKey: 'studio.image.stroke.dotted' },
      { value: 3, labelKey: 'studio.image.stroke.dashed' },
    ]);
    expect(CAPS).toEqual(['round', 'butt', 'square']);
    expect(JOINS).toEqual(['round', 'miter', 'bevel']);
  });
});

describe('defaultBorderAlign — a régi (igazítás nélküli) körvonal helye', () => {
  it.each([
    ['rectangle', 'inside'],
    ['ellipse', 'inside'],
    ['path', 'center'],
    ['line', 'outside'],
    ['arrow', 'outside'],
    ['star', 'outside'],
    ['polygon', 'outside'],
  ] as const)('%s → %s', (s, expected) => {
    expect(defaultBorderAlign(shape(s))).toBe(expected);
  });

  it('a megadott borderAlign-t nem nézi (az a hívó dolga)', () => {
    expect(defaultBorderAlign({ ...shape('rectangle'), borderAlign: 'outside' })).toBe('inside');
  });
});
