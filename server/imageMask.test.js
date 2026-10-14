const { maskWExpr, maskGrayChain, staticPoly } = require('./imageMask');

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
