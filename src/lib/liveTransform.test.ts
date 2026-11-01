import { MIN_SOURCE_SIZE, moveTransform, resizeTransform, scaleTransform } from '@/lib/liveTransform';
import type { LiveTransform } from '@/types/live';

const t = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, z: 0 }) as LiveTransform;

describe('moveTransform', () => {
  it('eltol', () => {
    expect(moveTransform(t(0.1, 0.1, 0.2, 0.2), 0.1, 0.2)).toMatchObject({ x: 0.2, y: expect.closeTo(0.3) });
  });

  it('a keret a vásznon marad', () => {
    expect(moveTransform(t(0.5, 0.5, 0.4, 0.4), 1, -1)).toMatchObject({ x: 0.6, y: 0 });
  });
});

describe('resizeTransform', () => {
  it('a bal felső sarok áll', () => {
    expect(resizeTransform(t(0.1, 0.1, 0.2, 0.2), 0.1, 0.1)).toMatchObject({ x: 0.1, y: 0.1, w: expect.closeTo(0.3), h: expect.closeTo(0.3) });
  });

  it('nem lehet túl kicsi és nem lóg ki', () => {
    expect(resizeTransform(t(0.1, 0.1, 0.2, 0.2), -1, -1)).toMatchObject({ w: MIN_SOURCE_SIZE, h: MIN_SOURCE_SIZE });
    expect(resizeTransform(t(0.5, 0.5, 0.2, 0.2), 1, 1)).toMatchObject({ w: 0.5, h: 0.5 });
  });
});

describe('scaleTransform', () => {
  it('a közepe körül nő, az arány marad', () => {
    const out = scaleTransform(t(0.4, 0.4, 0.2, 0.1), 2);
    expect(out.w).toBeCloseTo(0.4);
    expect(out.h).toBeCloseTo(0.2);
    expect(out.x + out.w / 2).toBeCloseTo(0.5);
    expect(out.y + out.h / 2).toBeCloseTo(0.45);
  });

  it('a vászon szélénél a keret bent marad', () => {
    const out = scaleTransform(t(0, 0, 0.4, 0.4), 2);
    expect([out.x, out.y]).toEqual([0, 0]);
    expect(out.w).toBeCloseTo(0.8);
  });

  it('a szorzó korlátos: nem lesz nagyobb a vászonnál, sem kisebb a minimumnál', () => {
    expect(scaleTransform(t(0.2, 0.2, 0.5, 0.5), 10).w).toBeCloseTo(1);
    expect(scaleTransform(t(0.2, 0.2, 0.5, 0.2), 0.01).h).toBeCloseTo(MIN_SOURCE_SIZE);
  });
});
