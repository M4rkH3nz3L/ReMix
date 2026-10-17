import { audioLaneTarget, zoomIndexForPinch } from '@/lib/audioTimelineGestures';

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

describe('zoomIndexForPinch', () => {
  const N = 7; // ZOOM_LEVELS.length

  it('scale 1 → ugyanaz a szint', () => {
    expect(zoomIndexForPinch(3, 1, N)).toBe(3);
  });

  it('~1,6× nagyítás → +1 szint, ~2,56× → +2', () => {
    expect(zoomIndexForPinch(3, 1.6, N)).toBe(4);
    expect(zoomIndexForPinch(3, 1.6 * 1.6, N)).toBe(5);
  });

  it('~0,62× kicsinyítés → −1 szint', () => {
    expect(zoomIndexForPinch(3, 1 / 1.6, N)).toBe(2);
  });

  it('a szélen clampel [0, N-1]', () => {
    expect(zoomIndexForPinch(6, 5, N)).toBe(6);
    expect(zoomIndexForPinch(0, 0.1, N)).toBe(0);
  });

  it('érvénytelen scale/levelCount → változatlan', () => {
    expect(zoomIndexForPinch(3, 0, N)).toBe(3);
    expect(zoomIndexForPinch(3, -1, N)).toBe(3);
    expect(zoomIndexForPinch(3, 1.6, 0)).toBe(3);
  });
});
