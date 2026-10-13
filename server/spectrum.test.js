const { spectrumFilter } = require('./spectrum');

describe('spectrum — showspectrumpic filter', () => {
  test('alapértelmezett méret + combined mód + legenda', () => {
    const f = spectrumFilter({});
    expect(f).toContain('showspectrumpic=s=720x360');
    expect(f).toContain('mode=combined');
    expect(f).toContain('legend=1');
    expect(f).toContain('scale=log');
  });

  test('egyedi méret + separate mód', () => {
    const f = spectrumFilter({ width: 1000, height: 400, mode: 'separate' });
    expect(f).toContain('s=1000x400');
    expect(f).toContain('mode=separate');
  });

  test('méret-clamp (tartományba szorít)', () => {
    expect(spectrumFilter({ width: 50, height: 50 })).toContain('s=160x120');
    expect(spectrumFilter({ width: 9999, height: 9999 })).toContain('s=1920x1080');
  });
});
