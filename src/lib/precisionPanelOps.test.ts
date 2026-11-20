import { snap, STEP, TRANSFORM_CHANNELS } from '@/lib/precisionPanelOps';
import type { ImageClip, VideoClip } from '@/types/project';

const media = (over: Record<string, unknown>) => ({ kind: 'video', id: 'v', ...over }) as unknown as VideoClip | ImageClip;

describe('precisionPanelOps — lépés és kerekítés', () => {
  it('a másodperces lépés 0,1 s', () => {
    expect(STEP).toBe(0.1);
  });

  it('sec-módban századra kerekít (nem tizedre), a fps-t figyelmen kívül hagyja', () => {
    expect(snap(1.234, 'sec', 25)).toBe(1.23);
    expect(snap(1.235001, 'sec', 25)).toBe(1.24);
    expect(snap(-0.004, 'sec', 30)).toBe(-0);
  });

  it('frame-módban a projekt frame-rácsára ül; érvénytelen fps → 30', () => {
    expect(snap(1.03, 'frame', 25)).toBe(1.04);
    expect(snap(1.01, 'frame', 24)).toBe(1);
    expect(snap(0.5, 'frame', 0)).toBe(15 / 30);
    expect(snap(0.02, 'frame', 30)).toBeCloseTo(1 / 30, 12);
  });
});

describe('precisionPanelOps — a Graph Editor csatornái', () => {
  it('a sorrend, a címke-kulcsok és a tartományok', () => {
    expect(TRANSFORM_CHANNELS.map((c) => [c.id, c.label, c.min, c.max])).toEqual([
      ['scale', 'panels.precision.chScale', 0.2, 4],
      ['x', 'panels.precision.chX', -0.75, 0.75],
      ['y', 'panels.precision.chY', -0.75, 0.75],
      ['rotation', 'panels.precision.chRotation', -180, 180],
      ['opacity', 'panels.precision.chOpacity', 0, 1],
    ]);
  });

  it('a szél-érték transzform nélkül az alapérték (1 / 0 / 0 / 0 / 1), egyébként a klipé', () => {
    expect(TRANSFORM_CHANNELS.map((c) => c.fallback(media({})))).toEqual([1, 0, 0, 0, 1]);
    const m = media({ transform: { scale: 2.5, x: -0.2, y: 0.3, rotation: 45 }, opacity: 0.4 });
    expect(TRANSFORM_CHANNELS.map((c) => c.fallback(m))).toEqual([2.5, -0.2, 0.3, 45, 0.4]);
  });

  it('a megjelenítés: ×-szorzó két tizedessel, százalék és fok egészre kerekítve', () => {
    expect(TRANSFORM_CHANNELS.map((c) => c.fmt(0.456))).toEqual(['0.46×', '46%', '46%', '0°', '46%']);
    expect(TRANSFORM_CHANNELS.map((c) => c.fmt(-12.5))).toEqual(['-12.50×', '-1250%', '-1250%', '-12°', '-1250%']);
  });
});
