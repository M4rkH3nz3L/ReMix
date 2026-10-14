const { maskWExpr, maskGrayChain, staticPoly, maskToBox } = require('./imageMask');

describe('imageMask — ClipMask → geq alfa-súly (render-paritás)', () => {
  test('ellipszis: normalizált távolság / feather', () => {
    const e = maskWExpr({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6, feather: 0.05 }, 256, 256);
    expect(e).toContain('sqrt(pow((X-128.0)/(76.8),2)+pow((Y-128.0)/(76.8),2))');
    expect(e).toContain('/0.050,0),1)');
  });

  test('téglalap: él-távolság + feather(px)', () => {
    const r = maskWExpr({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 200, 200);
    expect(r).toContain('min(min(X-((100.0)-(50.0))');
  });

  test('invert → (1-w); opacity-padló megemeli az alsó szintet', () => {
    const inv = maskWExpr({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.5, invert: true }, 100, 100);
    expect(inv.startsWith('(1-')).toBe(true);
    const floored = maskWExpr({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 0.3 }, 100, 100);
    expect(floored).toContain('(0.300+0.700*(');
  });

  test('poligon: legyező-trianguláció (gte/lte szorzatok összege)', () => {
    const pts = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }];
    const p = staticPoly(pts, 100, 100, 0);
    expect(p).toContain('gte(');
    expect(p).toContain('lte(');
    expect(p.startsWith('min(')).toBe(true);
  });

  test('maskToBox: teljes-képes réteg → identitás; fél-méretű → átskálázás', () => {
    const full = { x: 0.3, y: 0.7, w: 0.4, h: 0.4, points: [{ x: 0.2, y: 0.8 }] };
    const id = maskToBox(full, { w: 1, h: 1, position: { x: 0.5, y: 0.5 } });
    expect(id.x).toBeCloseTo(0.3);
    expect(id.w).toBeCloseTo(0.4);
    expect(id.points[0]).toEqual({ x: 0.2, y: 0.8 });
    // fél-méretű, középen álló réteg: a doboz [0.25,0.75]; a vászon-közép (0.5) → box-közép (0.5)
    const half = maskToBox({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, { w: 0.5, h: 0.5, position: { x: 0.5, y: 0.5 } });
    expect(half.x).toBeCloseTo(0.5);
    expect(half.w).toBeCloseTo(0.5); // 0.25 / 0.5
  });

  test('maskGrayChain: teljes-vászon szürke forrás + geq + címke; poligon→feather gblur', () => {
    const c = maskGrayChain({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 64, 64, '[m]');
    expect(c).toBe(
      `color=white:s=64x64,format=gray,geq=lum='255*${maskWExpr({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 64, 64)}'[m]`
    );
    const poly = maskGrayChain(
      { shape: 'polygon', x: 0.5, y: 0.5, w: 0.5, h: 0.5, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }], feather: 0.1 },
      64,
      64,
      '[m]'
    );
    expect(poly).toContain('gblur=sigma=');
  });
});
