import {
  createPattern,
  DEFAULT_PATTERN,
  isRenderablePattern,
  patternToSvg,
  patternTransform,
  tilePositions,
} from '@/lib/patternFill';

describe('patternFill — tiling math', () => {
  it('tile: kitölti a dobozt', () => {
    const { tiles, truncated } = tilePositions(100, 100, DEFAULT_PATTERN); // tw=25
    expect(truncated).toBe(false);
    expect(tiles).toHaveLength(16); // 4×4
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: 25, h: 25 });
    expect(tiles).toContainEqual({ x: 75, y: 75, w: 25, h: 25 });
  });

  it('no-repeat: egyetlen csempe az offseten', () => {
    const p = createPattern({ repeat: 'no-repeat', offsetX: 0.1, offsetY: 0.2 });
    const { tiles } = tilePositions(100, 100, p);
    expect(tiles).toEqual([{ x: 10, y: 20, w: 25, h: 25 }]);
  });

  it('tile-x: egy sor', () => {
    const { tiles } = tilePositions(100, 100, createPattern({ repeat: 'tile-x' }));
    expect(tiles).toHaveLength(4);
    expect(tiles.every((t) => t.y === 0)).toBe(true);
  });

  it('tile-y: egy oszlop', () => {
    const { tiles } = tilePositions(100, 100, createPattern({ repeat: 'tile-y' }));
    expect(tiles).toHaveLength(4);
    expect(tiles.every((t) => t.x === 0)).toBe(true);
  });

  it('spacing tágítja a lépést', () => {
    const { tiles } = tilePositions(100, 100, createPattern({ spacing: 1 })); // step=50
    // soronként 2 (x=0,50), 2 sor → 4
    expect(tiles).toHaveLength(4);
    expect(tiles).toContainEqual({ x: 50, y: 50, w: 25, h: 25 });
  });

  it('scale nagyítja a csempét', () => {
    const { tiles } = tilePositions(100, 100, createPattern({ scale: 2 })); // tw=50
    expect(tiles[0].w).toBe(50);
    expect(tiles).toHaveLength(4); // 2×2
  });

  it('negatív fázis fedi a bal/felső szélt', () => {
    const { tiles } = tilePositions(100, 100, createPattern({ offsetX: 0.1, offsetY: 0.1 }));
    // startX = 10 → visszatolva -15 (10-25), így a szél fedve
    expect(tiles.some((t) => t.x < 0)).toBe(true);
  });

  it('plafon: truncated a robbanás ellen', () => {
    const { tiles, truncated } = tilePositions(100000, 100000, createPattern({ tileWidth: 0.0001, tileHeight: 0.0001 }));
    expect(truncated).toBe(true);
    expect(tiles.length).toBeLessThanOrEqual(10000);
  });
});

describe('patternFill — SVG emit', () => {
  it('patternTransform: eltolás + forgatás a közép körül', () => {
    const p = createPattern({ offsetX: 0.1, rotation: 45 });
    expect(patternTransform(p, 100, 200)).toBe('translate(10 0) rotate(45 50 100)');
  });

  it('kép-minta → <pattern> + <image>', () => {
    const svg = patternToSvg(createPattern({ imageUri: 'tex.png' }), 'p1', 100, 100);
    expect(svg).toContain('<pattern id="p1" patternUnits="userSpaceOnUse" width="25" height="25"');
    expect(svg).toContain('<image href="tex.png"');
    expect(svg).toContain('width="25" height="25"');
  });

  it('alakzat-minta → a tileSvg beágyazva, opacity csoporttal', () => {
    const p = createPattern({ kind: 'shapes', tileSvg: '<circle cx="5" cy="5" r="4"/>', opacity: 0.5, tileWidth: 0.1, tileHeight: 0.1 });
    const svg = patternToSvg(p, 'p2', 100, 100);
    expect(svg).toContain('<g opacity="0.5"><circle cx="5" cy="5" r="4"/></g>');
    expect(svg).toContain('width="10" height="10"');
  });

  it('háttérszín rect-ként', () => {
    const svg = patternToSvg(createPattern({ imageUri: 'x.png', backgroundColor: '#eee' }), 'p3', 40, 40);
    expect(svg).toContain('<rect x="0" y="0" width="10" height="10" fill="#eee"/>');
  });

  it('isRenderablePattern', () => {
    expect(isRenderablePattern(createPattern({ imageUri: 'x.png' }))).toBe(true);
    expect(isRenderablePattern(createPattern({}))).toBe(false); // nincs uri
    expect(isRenderablePattern(createPattern({ imageUri: 'x.png', opacity: 0 }))).toBe(false);
    expect(isRenderablePattern(createPattern({ kind: 'shapes', tileSvg: '<rect/>' }))).toBe(true);
  });
});
