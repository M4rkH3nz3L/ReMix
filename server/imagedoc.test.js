const { imageOutputArgs } = require('./imagedoc');

describe('imageOutputArgs (export-formátum → ffmpeg)', () => {
  test('alap = PNG (veszteségmentes, extra args nélkül)', () => {
    expect(imageOutputArgs()).toEqual({ ext: 'png', args: [] });
    expect(imageOutputArgs('png', 0.5).ext).toBe('png');
    expect(imageOutputArgs('ismeretlen', 0.5)).toEqual({ ext: 'png', args: [] });
  });

  test('JPG → yuv420p + q:v a minőségből (1=legjobb→2, 0=legrosszabb→31)', () => {
    const best = imageOutputArgs('jpg', 1);
    expect(best.ext).toBe('jpg');
    expect(best.args).toContain('-q:v');
    expect(best.args[best.args.indexOf('-q:v') + 1]).toBe('2');
    const worst = imageOutputArgs('jpeg', 0);
    expect(worst.args[worst.args.indexOf('-q:v') + 1]).toBe('31');
    expect(worst.ext).toBe('jpg'); // jpeg → jpg
  });

  test('WebP → libwebp + 0–100 minőség', () => {
    const w = imageOutputArgs('webp', 0.8);
    expect(w.ext).toBe('webp');
    expect(w.args).toContain('-c:v');
    expect(w.args).toContain('libwebp');
    expect(w.args[w.args.indexOf('-quality') + 1]).toBe('80');
  });

  test('a minőség 0–1-re szorítva + alapérték hibás bemenetre', () => {
    expect(imageOutputArgs('jpg', 5).args[imageOutputArgs('jpg', 5).args.indexOf('-q:v') + 1]).toBe('2');
    expect(imageOutputArgs('jpg', -3).args[imageOutputArgs('jpg', -3).args.indexOf('-q:v') + 1]).toBe('31');
    // NaN → alap 0.92
    const def = imageOutputArgs('webp', NaN);
    expect(def.args[def.args.indexOf('-quality') + 1]).toBe('92');
  });
});
