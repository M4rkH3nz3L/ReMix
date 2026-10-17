import { audioLaneTarget } from '@/lib/audioTimelineGestures';

describe('audioLaneTarget', () => {
  const H = 70;

  it('kis elmozdulás (< fél sáv) → marad a sávon', () => {
    expect(audioLaneTarget(1, 10, H, 3)).toBe(1);
    expect(audioLaneTarget(1, -30, H, 3)).toBe(1); // |−30| < 35
  });

  it('egy sávnyi lefelé húzás → +1 index', () => {
    expect(audioLaneTarget(0, H, H, 3)).toBe(1);
    expect(audioLaneTarget(1, H, H, 3)).toBe(2);
  });

  it('egy sávnyi felfelé húzás → −1 index', () => {
    expect(audioLaneTarget(2, -H, H, 3)).toBe(1);
  });

  it('a szélen nem lép túl (clamp [0, count-1])', () => {
    expect(audioLaneTarget(2, 3 * H, H, 3)).toBe(2); // alul már nincs lejjebb
    expect(audioLaneTarget(0, -3 * H, H, 3)).toBe(0); // felül már nincs feljebb
  });

  it('két sávnyi ugrás', () => {
    expect(audioLaneTarget(0, 2 * H, H, 3)).toBe(2);
  });

  it('érvénytelen bemenet → változatlan index', () => {
    expect(audioLaneTarget(-1, H, H, 3)).toBe(-1);
    expect(audioLaneTarget(1, H, 0, 3)).toBe(1);
    expect(audioLaneTarget(1, H, H, 0)).toBe(1);
  });
});
