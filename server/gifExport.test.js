const { gifArgs } = require('./render');

describe('gifArgs — GIF-export argumentumok (VIDEO-STUDIO §5)', () => {
  test('alapértelmezés: 15 fps, 480 px, palette-lánc + loop 0', () => {
    const g = gifArgs({});
    expect(g.ext).toBe('gif');
    expect(g.fps).toBe(15);
    expect(g.width).toBe(480);
    expect(g.args).toEqual(['-vf', expect.stringContaining('palettegen'), '-loop', '0']);
    const vf = g.args[1];
    expect(vf).toContain('fps=15');
    expect(vf).toContain('scale=480:-1:flags=lanczos');
    expect(vf).toContain('paletteuse');
  });

  test('egyedi fps/width tiszteletben tartva', () => {
    const g = gifArgs({ gifFps: 24, gifWidth: 720 });
    expect(g.fps).toBe(24);
    expect(g.width).toBe(720);
    expect(g.args[1]).toContain('fps=24');
    expect(g.args[1]).toContain('scale=720:-1');
  });

  test('tartomány-clamp: fps 5–30, width 120–1080', () => {
    expect(gifArgs({ gifFps: 1 }).fps).toBe(5);
    expect(gifArgs({ gifFps: 999 }).fps).toBe(30);
    expect(gifArgs({ gifWidth: 10 }).width).toBe(120);
    expect(gifArgs({ gifWidth: 99999 }).width).toBe(1080);
  });

  test('nem-szám bemenet → alapértelmezés', () => {
    const g = gifArgs({ gifFps: 'abc', gifWidth: null });
    expect(g.fps).toBe(15);
    expect(g.width).toBe(480);
  });
});
