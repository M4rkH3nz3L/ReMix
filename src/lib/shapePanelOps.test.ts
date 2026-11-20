import { booleanResultClip, GLOW_PRESETS, GRADIENTS, OUTLINE_PRESETS } from '@/lib/shapePanelOps';
import type { ShapeClip } from '@/types/project';

const shape = (over: Partial<ShapeClip>) =>
  ({ kind: 'shape', id: 'a', start: 2, duration: 3, shape: 'rectangle', position: { x: 0.3, y: 0.4 }, w: 0.2, h: 0.2, fill: '#ff0000', ...over }) as ShapeClip;
const result = { subpaths: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]], fillRule: 'evenodd' as const };

describe('shapePanelOps — a Forma-panel presetjei', () => {
  it('a két-színű gradiensek: id, sorrend és a pontos színek (az aktív chip a `from` alapján dől el)', () => {
    expect(GRADIENTS).toEqual([
      { id: 'purplePink', from: '#7c5cff', to: '#ff5ca8' },
      { id: 'blueTurquoise', from: '#4d9dff', to: '#5cffd0' },
      { id: 'sunset', from: '#ff6b4a', to: '#ffb85c' },
    ]);
  });

  it('a ragyogás- és körvonal-presetek: id → emoji + szín, sorrendben', () => {
    expect(GLOW_PRESETS.map((g) => [g.id, g.emoji, g.color])).toEqual([
      ['cyan', '🩵', '#00e5ff'],
      ['pink', '💗', '#ff2d95'],
      ['white', '🤍', '#ffffff'],
      ['gold', '💛', '#ffd166'],
    ]);
    expect(OUTLINE_PRESETS.map((o) => [o.id, o.emoji, o.color])).toEqual([
      ['white', '🤍', '#ffffff'],
      ['black', '🖤', '#0b0b18'],
      ['pink', '💗', '#ff2d95'],
    ]);
  });
});

describe('shapePanelOps — booleanResultClip', () => {
  it('a két forma közös idősávját fedi: a korábbi kezdettől a későbbi végig', () => {
    const c = booleanResultClip(shape({ start: 2, duration: 3 }), shape({ id: 'b', start: 4, duration: 6 }), result, 'clip_9');
    expect(c.start).toBe(2);
    expect(c.duration).toBe(8);
  });

  it('a tartalmazott forma nem nyújtja meg a sávot', () => {
    const c = booleanResultClip(shape({ start: 1, duration: 10 }), shape({ id: 'b', start: 3, duration: 2 }), result, 'x');
    expect([c.start, c.duration]).toEqual([1, 10]);
  });

  it('vászon-térben (w=h=1, középen) zárt path, az ELSŐDLEGES forma kitöltésével — a gradiens nélkül nincs gradient-kulcs', () => {
    const c = booleanResultClip(shape({ fill: '#abcdef' }), shape({ id: 'b', fill: '#000000' }), result, 'clip_1');
    expect(c).toEqual({
      kind: 'shape',
      id: 'clip_1',
      start: 2,
      duration: 3,
      shape: 'path',
      closed: true,
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fill: '#abcdef',
      subpaths: result.subpaths,
      fillRule: 'evenodd',
    });
    expect(Object.keys(c)).not.toContain('gradient');
  });

  it('az elsődleges forma gradiense átöröklődik (a másiké nem), és a kulcs-sorrend a régi literálé', () => {
    const gradient = { type: 'radial' as const, stops: [{ color: '#fff', at: 0 }, { color: '#000', at: 1 }] };
    const c = booleanResultClip(shape({ gradient }), shape({ id: 'b', gradient: { ...gradient, type: 'conic' } }), result, 'g');
    expect(c.gradient).toBe(gradient);
    expect(Object.keys(c)).toEqual(['kind', 'id', 'start', 'duration', 'shape', 'closed', 'position', 'w', 'h', 'fill', 'subpaths', 'fillRule', 'gradient']);
    const other = booleanResultClip(shape({}), shape({ id: 'b', gradient }), result, 'g2');
    expect(other.gradient).toBeUndefined();
  });

  it('a kulcskockák, a keret és a kép NEM öröklődnek', () => {
    const c = booleanResultClip(
      shape({ keyframes: { x: [{ t: 0, v: 1 }] }, borderWidth: 1, imageUri: 'file:///a.png' } as unknown as Partial<ShapeClip>),
      shape({ id: 'b' }),
      result,
      'k'
    );
    expect(c).not.toHaveProperty('keyframes');
    expect(c).not.toHaveProperty('borderWidth');
    expect(c).not.toHaveProperty('imageUri');
  });
});
