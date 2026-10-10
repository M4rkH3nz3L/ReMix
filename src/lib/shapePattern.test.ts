import {
  createShapePattern,
  DEFAULT_SHAPE_PATTERN,
  isRenderableShapePattern,
  PATTERN_PRESETS,
  patternPrimToSvg,
  patternTile,
  shapePatternSvgDef,
  type ShapePattern,
} from './shapePattern';

describe('shapePattern mag', () => {
  it('createShapePattern az alapokból + felülírásból', () => {
    expect(createShapePattern()).toEqual(DEFAULT_SHAPE_PATTERN);
    const p = createShapePattern({ preset: 'grid', fg: '#ff0000', size: 12 });
    expect(p.preset).toBe('grid');
    expect(p.fg).toBe('#ff0000');
    expect(p.size).toBe(12);
    // az alapok megmaradnak
    expect(p.opacity).toBe(1);
  });

  it('a csempe-oldal a doboz MAGASSÁGÁNAK %-a (felbontás-független)', () => {
    const p = createShapePattern({ size: 10 });
    expect(patternTile(p, 1000).tile).toBe(100);
    expect(patternTile(p, 500).tile).toBe(50);
  });

  it('a csempének van minimum-mérete (nem fagy a rács)', () => {
    const p = createShapePattern({ size: 0.001 });
    expect(patternTile(p, 100).tile).toBeGreaterThanOrEqual(4);
  });

  it('dots → egy kör a csempe közepén', () => {
    const { tile, prims } = patternTile(createShapePattern({ preset: 'dots', fg: '#fff' }), 1000);
    expect(prims).toHaveLength(1);
    const c = prims[0];
    expect(c.t).toBe('circle');
    if (c.t === 'circle') {
      expect(c.cx).toBe(tile / 2);
      expect(c.cy).toBe(tile / 2);
      expect(c.r).toBeGreaterThan(0);
      expect(c.fill).toBe('#fff');
    }
  });

  it('grid → felső + bal él vonal', () => {
    const { prims } = patternTile(createShapePattern({ preset: 'grid' }), 1000);
    expect(prims).toHaveLength(2);
    expect(prims.every((p) => p.t === 'line')).toBe(true);
  });

  it('stripes → fél-csempe sáv', () => {
    const { tile, prims } = patternTile(createShapePattern({ preset: 'stripes' }), 1000);
    expect(prims).toHaveLength(1);
    const r = prims[0];
    if (r.t === 'rect') {
      expect(r.w).toBeCloseTo(tile / 2, 3);
      expect(r.h).toBe(tile);
    }
  });

  it('checker → két átlós cella', () => {
    const { tile, prims } = patternTile(createShapePattern({ preset: 'checker' }), 1000);
    expect(prims).toHaveLength(2);
    expect(prims.every((p) => p.t === 'rect')).toBe(true);
    if (prims[0].t === 'rect' && prims[1].t === 'rect') {
      expect(prims[0].x).toBe(0);
      expect(prims[0].y).toBe(0);
      expect(prims[1].x).toBe(tile / 2);
      expect(prims[1].y).toBe(tile / 2);
    }
  });

  it('patternPrimToSvg jól formált SVG-elemeket ad', () => {
    expect(patternPrimToSvg({ t: 'circle', cx: 5, cy: 5, r: 2, fill: '#f00' })).toBe(
      '<circle cx="5" cy="5" r="2" fill="#f00"/>'
    );
    expect(patternPrimToSvg({ t: 'rect', x: 0, y: 0, w: 4, h: 8, fill: '#0f0' })).toBe(
      '<rect x="0" y="0" width="4" height="8" fill="#0f0"/>'
    );
    expect(patternPrimToSvg({ t: 'line', x1: 0, y1: 1, x2: 4, y2: 1, stroke: '#00f', sw: 2 })).toBe(
      '<line x1="0" y1="1" x2="4" y2="1" stroke="#00f" stroke-width="2"/>'
    );
  });

  it('shapePatternSvgDef — userSpaceOnUse pattern, helyes méret + fill', () => {
    const svg = shapePatternSvgDef(createShapePattern({ preset: 'dots', size: 10 }), 'p1', 500, 1000);
    expect(svg).toContain('<pattern id="p1"');
    expect(svg).toContain('patternUnits="userSpaceOnUse"');
    expect(svg).toContain('width="100" height="100"'); // 10% × 1000
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('patternTransform'); // nincs forgatás
  });

  it('shapePatternSvgDef — forgatás a doboz közepe körül', () => {
    const svg = shapePatternSvgDef(
      createShapePattern({ preset: 'grid', rotation: 45 }),
      'p2',
      400,
      400
    );
    expect(svg).toContain('patternTransform="rotate(45 200 200)"');
  });

  it('shapePatternSvgDef — háttér + minta-opacity', () => {
    const svg = shapePatternSvgDef(
      createShapePattern({ preset: 'checker', bg: '#000', opacity: 0.5 }),
      'p3',
      300,
      300
    );
    expect(svg).toContain('fill="#000"'); // bg-rect
    expect(svg).toContain('<g opacity="0.5">');
  });

  it('isRenderableShapePattern — üres/rossz minta elutasítva', () => {
    expect(isRenderableShapePattern(undefined)).toBe(false);
    expect(isRenderableShapePattern(null)).toBe(false);
    expect(isRenderableShapePattern(createShapePattern({ opacity: 0 }))).toBe(false);
    expect(isRenderableShapePattern(createShapePattern({ size: 0 }))).toBe(false);
    expect(isRenderableShapePattern({ preset: 'nope' as ShapePattern['preset'], fg: '#fff', size: 8 })).toBe(
      false
    );
    expect(isRenderableShapePattern(createShapePattern())).toBe(true);
  });

  it('minden preset ad legalább egy primitívet', () => {
    for (const preset of PATTERN_PRESETS) {
      expect(patternTile(createShapePattern({ preset }), 800).prims.length).toBeGreaterThan(0);
    }
  });
});
