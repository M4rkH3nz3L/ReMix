import {
  coverScaleFor,
  needsReframe,
  panToCenter,
  pathToReframeKeyframes,
  sourceWindow,
  type ReframePoint,
} from '@/lib/reframe';
import type { VideoClip } from '@/types/project';

// 🎯 Auto Reframe (téma-útvonal → cover-scale + pan kulcskockák) pure pajzsa.

const LAND = 16 / 9;
const PORT = 9 / 16;

describe('coverScaleFor', () => {
  it('a rövidebb irányt húzza a vászonra (mindig ≥1 keresztarányban)', () => {
    expect(coverScaleFor(LAND, PORT)).toBeCloseTo(LAND / PORT, 3);
    expect(coverScaleFor(PORT, LAND)).toBeCloseTo(LAND / PORT, 3);
    expect(coverScaleFor(1, 1)).toBe(1);
  });
  it('nem-véges → 1', () => {
    expect(coverScaleFor(NaN, 1)).toBe(1);
    expect(coverScaleFor(1, Infinity)).toBe(1);
  });
});

describe('needsReframe', () => {
  it('azonos arány → nem; eltérő (16:9 → 9:16) → igen', () => {
    expect(needsReframe(1, 1)).toBe(false);
    expect(needsReframe(LAND, PORT)).toBe(true);
  });
});

describe('panToCenter', () => {
  it('a vászon közepén lévő téma → nincs eltolás', () => {
    const pan = panToCenter({ x: 0.5, y: 0.5 }, LAND, PORT, coverScaleFor(LAND, PORT));
    expect(pan.x).toBeCloseTo(0, 6);
    expect(pan.y).toBeCloseTo(0, 6);
  });
  it('a bal szélen lévő téma jobbra tolódik, de a crop nem lóg ki (clamp)', () => {
    const scale = coverScaleFor(LAND, PORT);
    const pan = panToCenter({ x: 0, y: 0.5 }, LAND, PORT, scale);
    // a megjelenített szélesség fele − fél vászon = maxX
    const dispW = 1 * scale;
    const maxX = (dispW - 1) / 2;
    expect(pan.x).toBeGreaterThan(0); // balról → jobbra tol
    expect(pan.x).toBeLessThanOrEqual(maxX + 1e-6); // nem lóg ki
  });
});

describe('pathToReframeKeyframes', () => {
  const pts: ReframePoint[] = [
    { t: 0, x: 0.5, y: 0.5 },
    { t: 0.1, x: 0.5, y: 0.5 }, // < stepSec → ritkítva kiesik
    { t: 1, x: 0.4, y: 0.6 },
  ];
  it('egy scale-kulcskocka + a ritkított x/y pálya; a végpontok megmaradnak', () => {
    const kf = pathToReframeKeyframes(pts, LAND, PORT, 1, 0.5);
    expect(kf.scale).toHaveLength(1);
    expect(kf.x).toHaveLength(2); // a 0.1-es köztes kiesett, a két végpont marad
    expect(kf.y).toHaveLength(2);
  });
  it('a forrás-időt 1/speed-del idővonal-időre skálázza', () => {
    const kf = pathToReframeKeyframes(pts, LAND, PORT, 2, 0.5);
    const xs = kf.x!;
    expect(xs[xs.length - 1].time).toBeCloseTo(0.5, 3); // t=1, speed=2 → 0.5
  });
});

describe('sourceWindow', () => {
  it('a klip látható forrás-ablaka (trimIn + duration*speed)', () => {
    const clip = { trimIn: 2, duration: 5, speed: 2 } as VideoClip;
    expect(sourceWindow(clip)).toEqual({ startSec: 2, durationSec: 10 });
  });
});
