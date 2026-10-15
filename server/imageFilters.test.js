const {
  filterChain,
  oneFilter,
  sepiaMixer,
  maskGradientFilter,
  shadowSilhouette,
  glowSilhouette,
  hexToRgb,
  strokeSilhouette,
  perspectiveFilter,
  gradientMapFilter,
  healChain,
} = require('./imageFilters');

describe('imageFilters — ffmpeg szűrő-lánc', () => {
  test('oneFilter: típusonkénti ffmpeg-részlet', () => {
    expect(oneFilter({ type: 'blur', amount: 1 })).toBe('gblur=sigma=20.00');
    expect(oneFilter({ type: 'blur', amount: 0.5 })).toBe('gblur=sigma=10.00');
    expect(oneFilter({ type: 'sharpen', amount: 1 })).toContain('unsharp=5:5:2.00');
    expect(oneFilter({ type: 'noise', amount: 1 })).toContain('noise=alls=40');
    expect(oneFilter({ type: 'grayscale', amount: 1 })).toBe('hue=s=0.000');
    expect(oneFilter({ type: 'grayscale', amount: 0 })).toBe('');
    expect(oneFilter({ type: 'sepia', amount: 1 })).toContain('colorchannelmixer=0.3930');
    expect(oneFilter({ type: 'clarity', amount: 1 })).toContain('unsharp=lx=13:ly=13:la=1.50');
    expect(oneFilter({ type: 'dehaze', amount: 1 })).toBe('eq=contrast=1.600:saturation=1.400');
    expect(oneFilter({ type: 'pixelate', amount: 1 })).toBe('pixelize=w=24:h=24');
    expect(oneFilter({ type: 'posterize', amount: 1 })).toContain("lutrgb=r='trunc(val/128)*128'");
    expect(oneFilter({ type: 'duotone', amount: 1 })).toContain('hue=s=0,lutrgb=');
  });

  test('sepiaMixer: amount=0 ≈ identitás, amount=1 = teljes szépia', () => {
    expect(sepiaMixer(0)).toContain('1.0000:0.0000:0.0000');
    expect(sepiaMixer(1)).toContain('0.3930:0.7690:0.1890');
  });

  test('filterChain: vezető vessző + több szűrő sorban', () => {
    const c = filterChain([{ type: 'blur', amount: 0.5 }, { type: 'grayscale', amount: 1 }]);
    expect(c).toBe(',gblur=sigma=10.00,hue=s=0.000');
  });

  test('filterChain: 0-erősségű/ismeretlen kiesik; üres → ""', () => {
    expect(filterChain([{ type: 'blur', amount: 0 }, { type: 'nope', amount: 1 }])).toBe('');
    expect(filterChain([])).toBe('');
    expect(filterChain(undefined)).toBe('');
  });

  test('shadowSilhouette: fekete lutrgb + blur + alfa-csökkentés', () => {
    const s = shadowSilhouette(5, 0.5);
    expect(s).toContain('lutrgb=r=0:g=0:b=0');
    expect(s).toContain('gblur=sigma=5.0');
    expect(s).toContain('colorchannelmixer=aa=0.500');
  });

  test('glowSilhouette: padding (túlterjedés) + glow-szín + blur + alfa', () => {
    const g = glowSilhouette(18, 6, 0.85);
    expect(g).toContain('pad=iw+36:ih+36:18:18');
    expect(g).toContain('lutrgb=r=124:g=92:b=255');
    expect(g).toContain('gblur=sigma=6.0');
    expect(g).toContain('colorchannelmixer=aa=0.850');
  });

  test('hexToRgb: #rrggbb → egész csatornák; hibás → fehér', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#7c5cff')).toEqual({ r: 124, g: 92, b: 255 });
    expect(hexToRgb('nope')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('strokeSilhouette: szín-kitöltés + 2N px növelés (nearest)', () => {
    const s = strokeSilhouette('#ff0000', 5);
    expect(s).toContain('lutrgb=r=255:g=0:b=0');
    expect(s).toContain('scale=iw+10:ih+10:flags=neighbor');
  });

  test('perspectiveFilter: nincs dőlés → ""; X>0 a jobb élt rövidíti', () => {
    expect(perspectiveFilter(0, 0, 100, 100)).toBe('');
    const px = perspectiveFilter(1, 0, 100, 100); // m=2 → PW=PH=104; hx=0.25 → TR.y=26, BR.y=78
    expect(px).toContain('pad=iw+4:ih+4:2:2:color=black@0');
    expect(px).toContain('perspective=0:0:104:26:0:104:104:78:sense=destination:interpolation=linear');
    // Y>0 az alsó élt rövidíti (a bal/jobb alsó x-ek befelé)
    const py = perspectiveFilter(0, 1, 100, 100); // vy=0.25 → BL.x=26, BR.x=78
    expect(py).toContain('perspective=0:0:104:0:26:104:78:104:sense=destination');
  });

  test('gradientMapFilter: hiányzó szín → ""; alfa-megőrzés + rgba-visszatérés', () => {
    expect(gradientMapFilter('', '#fff')).toBe('');
    const g = gradientMapFilter('#000080', '#ffff00'); // shadow(0,0,128) highlight(255,255,0)
    expect(g).toContain('format=gbrap,geq=');
    expect(g).toContain("r='0*(1-");
    expect(g).toContain("+255*(");
    expect(g).toContain("a='alpha(X,Y)',format=rgba");
  });

  test('healChain: doboz-lokális téglalapok → delogo (px), képbe clampelve; üres → ""', () => {
    expect(healChain(undefined, 256, 256)).toBe('');
    expect(healChain([], 256, 256)).toBe('');
    expect(healChain([{ x: 0.375, y: 0.375, w: 0.156, h: 0.156 }], 256, 256)).toBe(',delogo=x=96:y=96:w=40:h=40');
    // szélre lógó téglalap clampelődik (x≥1, x+w≤W-2)
    const c = healChain([{ x: 0, y: 0, w: 1, h: 1 }], 100, 100);
    expect(c).toContain('delogo=x=1:y=1:');
    expect(c).toContain('w=97'); // 100 - 1 - 2
  });

  test('maskGradientFilter: irányonkénti alfa-rámpa (geq), ismeretlen → ""', () => {
    expect(maskGradientFilter('right')).toContain("a='alpha(X,Y)*(1-X/W)'");
    expect(maskGradientFilter('left')).toContain("a='alpha(X,Y)*(X/W)'");
    expect(maskGradientFilter('down')).toContain("a='alpha(X,Y)*(1-Y/H)'");
    expect(maskGradientFilter('up')).toContain("a='alpha(X,Y)*(Y/H)'");
    expect(maskGradientFilter(undefined)).toBe('');
    expect(maskGradientFilter('nope')).toBe('');
  });
});
