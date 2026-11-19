const { missingRenderer, versionAtLeast } = require('./renderer');

describe('renderer-kapu', () => {
  it('a verzió-összevetés major.minor szerint dönt', () => {
    expect(versionAtLeast([8, 1], '8.1')).toBe(true);
    expect(versionAtLeast([8, 2], '8.1')).toBe(true);
    expect(versionAtLeast([9, 0], '8.1')).toBe(true);
    expect(versionAtLeast([8, 0], '8.1')).toBe(false);
    expect(versionAtLeast([5, 1], '8')).toBe(false);
    expect(versionAtLeast([Infinity, 0], '8.1')).toBe(true);
  });

  it('igény nélkül semmi sem hiányzik', () => {
    expect(missingRenderer({})).toEqual([]);
  });

  it('a hiányzó ffmpeg-verziót megnevezi', () => {
    const missing = missingRenderer({ ffmpeg: '999.0' });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/^ffmpeg/);
  });
});
