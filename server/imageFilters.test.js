const { filterChain, oneFilter, sepiaMixer, maskGradientFilter, shadowSilhouette } = require('./imageFilters');

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

  test('maskGradientFilter: irányonkénti alfa-rámpa (geq), ismeretlen → ""', () => {
    expect(maskGradientFilter('right')).toContain("a='alpha(X,Y)*(1-X/W)'");
    expect(maskGradientFilter('left')).toContain("a='alpha(X,Y)*(X/W)'");
    expect(maskGradientFilter('down')).toContain("a='alpha(X,Y)*(1-Y/H)'");
    expect(maskGradientFilter('up')).toContain("a='alpha(X,Y)*(Y/H)'");
    expect(maskGradientFilter(undefined)).toBe('');
    expect(maskGradientFilter('nope')).toBe('');
  });
});
