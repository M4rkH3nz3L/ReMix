const { samplerFilterComplex, MAX_HITS } = require('./sampler');

describe('sampler — step-minta filtergráf', () => {
  test('asplit + per-lépés késleltetés + amix (120 BPM)', () => {
    const b = samplerFilterComplex([0, 4, 8], { bpm: 120, bars: 1 });
    expect(b.fc).toContain('asplit=3');
    expect(b.fc).toContain('adelay=0|0');
    expect(b.fc).toContain('adelay=500|500'); // 4 lépés @120 = 0.5s
    expect(b.fc).toContain('adelay=1000|1000'); // 8 lépés = 1s
    expect(b.fc).toContain('amix=inputs=3');
    expect(b.fc).toContain('[aout]');
    expect(b.totalSec).toBe(2); // 16 × 0.125
  });

  test('egyetlen lépés: asplit=1 + amix=1', () => {
    const b = samplerFilterComplex([0], { bpm: 120, bars: 1 });
    expect(b.fc).toContain('asplit=1');
    expect(b.fc).toContain('amix=inputs=1');
  });

  test('üres lépés-lista → null', () => {
    expect(samplerFilterComplex([], { bpm: 120 })).toBeNull();
  });

  test('render-plafon: MAX_HITS fölött levág', () => {
    const many = Array.from({ length: MAX_HITS + 20 }, (_, i) => i);
    const b = samplerFilterComplex(many, { bpm: 120, bars: 20 });
    expect(b.fc).toContain(`asplit=${MAX_HITS}`);
  });
});
