import { gestureKeyframes, replaceMotionKeyframes } from '@/lib/keyframes';
import type { ClipKeyframes } from '@/types/project';

// 🎬 MO-B1: a mozgás-csatornák írása nem törölheti a klip többi kulcskockáját
const kf = (time: number, value: number) => ({ time, value, easing: 'linear' as const });
const full: ClipKeyframes = {
  scale: [kf(0, 1), kf(2, 1.5)],
  x: [kf(0, 0)],
  opacity: [kf(0, 0), kf(1, 1)],
  volume: [kf(0, 1), kf(3, 0)],
  pan: [kf(0, -1)],
  fxReverb: [kf(0, 0.2)],
};

describe('MO-B1 — a vászon-gesztus megtartja a többi csatornát', () => {
  it('átlátszóság, hangerő, pan, effekt marad; a mozgás a lejátszófejnél új kulcskockát kap', () => {
    const out = gestureKeyframes(full, 1, { scale: 1.2, x: 0.1, y: -0.1, rotation: 15 });
    expect(out.opacity).toEqual(full.opacity);
    expect(out.volume).toEqual(full.volume);
    expect(out.pan).toEqual(full.pan);
    expect(out.fxReverb).toEqual(full.fxReverb);
    expect(out.scale).toEqual([kf(0, 1), { time: 1, value: 1.2, easing: 'easeInOut' }, kf(2, 1.5)]);
    expect(out.rotation).toEqual([{ time: 1, value: 15, easing: 'easeInOut' }]);
  });
  it('a bemenet nem változik (tiszta)', () => {
    const before = JSON.stringify(full);
    gestureKeyframes(full, 1, { scale: 2, x: 0, y: 0, rotation: 0 });
    expect(JSON.stringify(full)).toBe(before);
  });
});

describe('MO-B1 — a kamera-preset csak a mozgást cseréli', () => {
  it('a régi mozgás-csatornák helyére az újak; a többi marad; a meg nem adott mozgás törlődik', () => {
    const out = replaceMotionKeyframes(full, { scale: [kf(0, 1), kf(4, 1.28)] });
    expect(out.scale).toEqual([kf(0, 1), kf(4, 1.28)]);
    expect(out.x).toBeUndefined();
    expect(out.opacity).toEqual(full.opacity);
    expect(out.volume).toEqual(full.volume);
    expect(out.fxReverb).toEqual(full.fxReverb);
  });
  it('kulcskocka nélküli klipen is működik', () => {
    expect(replaceMotionKeyframes(undefined, { x: [kf(0, 0.05)] })).toEqual({ x: [kf(0, 0.05)] });
  });
});
