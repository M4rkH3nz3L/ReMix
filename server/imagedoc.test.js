const { imageOutputArgs, imageDocGuard, MAX_LAYERS, MAX_TOTAL_POINTS } = require('./imagedoc');

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

describe('imageDocGuard (nagy-doc védőkorlát)', () => {
  const layer = () => ({ kind: 'shape', shape: 'rectangle', w: 0.5, h: 0.5, fill: '#000' });

  test('normál doc → null (rendben)', () => {
    expect(imageDocGuard({ layers: [layer(), layer(), { kind: 'fill', fill: '#111' }] })).toBeNull();
    expect(imageDocGuard({ layers: [] })).toBeNull();
    expect(imageDocGuard({})).toBeNull();
    expect(imageDocGuard(null)).toBeNull();
  });

  test('túl sok réteg → beszédes hiba', () => {
    const many = Array.from({ length: MAX_LAYERS + 1 }, layer);
    const err = imageDocGuard({ layers: many });
    expect(err).toMatch(/Túl sok réteg/);
    expect(err).toContain(String(MAX_LAYERS + 1));
    // pontosan a határ még rendben
    expect(imageDocGuard({ layers: Array.from({ length: MAX_LAYERS }, layer) })).toBeNull();
  });

  test('túl sok path-pont (points + subpaths együtt) → beszédes hiba', () => {
    const big = { kind: 'shape', shape: 'path', w: 1, h: 1, fill: '#000', points: new Array(MAX_TOTAL_POINTS + 1).fill({ x: 0.5, y: 0.5 }) };
    expect(imageDocGuard({ layers: [big] })).toMatch(/Túl összetett/);
    const bigSub = {
      kind: 'shape',
      shape: 'path',
      w: 1,
      h: 1,
      fill: '#000',
      subpaths: [new Array(MAX_TOTAL_POINTS).fill({ x: 0, y: 0 }), new Array(5).fill({ x: 0, y: 0 })],
    };
    expect(imageDocGuard({ layers: [bigSub] })).toMatch(/Túl összetett/);
  });
});
