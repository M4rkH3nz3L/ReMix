import { gridLines, snapBoxToGrid, snapPointToGrid } from '@/lib/imageGrid';

const canvas = { width: 320, height: 160 };
const grid = { size: 32, show: true, snap: true };

describe('rács', () => {
  it('a pont a legközelebbi rácspontra ugrik, tengelyenként a saját méret szerint', () => {
    const p = snapPointToGrid({ x: 0.33, y: 0.49 }, grid, canvas);
    expect(p.x * 320).toBeCloseTo(96);
    expect(p.y * 160).toBeCloseTo(64);
  });
  it('illesztés nélkül vagy rács nélkül nem mozdít', () => {
    const p = { x: 0.33, y: 0.49 };
    expect(snapPointToGrid(p, { ...grid, snap: false }, canvas)).toBe(p);
    expect(snapPointToGrid(p, undefined, canvas)).toBe(p);
  });
  it('a réteg bal felső sarka ül a rácson, a méret nem változik', () => {
    const c = snapBoxToGrid({ x: 0.5, y: 0.5 }, { w: 0.21, h: 0.33 }, grid, canvas);
    expect(((c.x - 0.105) * 320) % 32).toBeCloseTo(0);
    expect(Math.round((c.y - 0.165) * 160) % 32).toBe(0);
  });
  it('a vonalak a rács méretét követik, a szélre nem kerül vonal', () => {
    const { xs, ys } = gridLines(grid, canvas, { w: 320, h: 160 });
    expect(xs).toHaveLength(9);
    expect(ys).toHaveLength(4);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
  it('a túl sűrű vagy rejtett rács nem rajzolódik', () => {
    expect(gridLines({ ...grid, size: 8 }, { width: 4000, height: 4000 }, { w: 300, h: 300 }).xs).toHaveLength(0);
    expect(gridLines({ ...grid, show: false }, canvas, { w: 320, h: 160 }).xs).toHaveLength(0);
  });
});
