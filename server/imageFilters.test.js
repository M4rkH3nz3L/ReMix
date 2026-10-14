const { filterChain, oneFilter, sepiaMixer } = require('./imageFilters');

describe('imageFilters — ffmpeg szűrő-lánc', () => {
  test('oneFilter: típusonkénti ffmpeg-részlet', () => {
    expect(oneFilter({ type: 'blur', amount: 1 })).toBe('gblur=sigma=20.00');
    expect(oneFilter({ type: 'blur', amount: 0.5 })).toBe('gblur=sigma=10.00');
    expect(oneFilter({ type: 'sharpen', amount: 1 })).toContain('unsharp=5:5:2.00');
    expect(oneFilter({ type: 'noise', amount: 1 })).toContain('noise=alls=40');
    expect(oneFilter({ type: 'grayscale', amount: 1 })).toBe('hue=s=0.000');
    expect(oneFilter({ type: 'grayscale', amount: 0 })).toBe('');
    expect(oneFilter({ type: 'sepia', amount: 1 })).toContain('colorchannelmixer=0.3930');
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
});
