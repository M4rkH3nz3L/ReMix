import {
  addMaskKeyframe,
  hasMaskTrack,
  maskKeyframeTimes,
  removeMaskKeyframeAt,
  sampleMaskAt,
  trackToPoints,
} from '@/lib/maskAnim';
import type { ClipMask, MaskFrame } from '@/types/project';

// 🎬 Animált maszk (rotoszkóp/követés; preview↔render interpoláció-paritás) pure pajzsa.

const frame = (over: Partial<MaskFrame>): MaskFrame =>
  ({ time: 0, x: 0.5, y: 0.5, w: 0.3, h: 0.3, feather: 0.05, ...over } as MaskFrame);

const mask = (over: Partial<ClipMask> = {}): ClipMask =>
  ({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.3, h: 0.3, feather: 0.05, ...(over as object) } as ClipMask);

describe('hasMaskTrack', () => {
  it('track nélkül false, kulcskockákkal true', () => {
    expect(hasMaskTrack(mask())).toBe(false);
    expect(hasMaskTrack(mask({ track: [frame({})] }))).toBe(true);
    expect(hasMaskTrack(null)).toBe(false);
  });
});

describe('sampleMaskAt', () => {
  it('track nélkül a maszk változatlan', () => {
    const m = mask({ x: 0.2 });
    expect(sampleMaskAt(m, 3).x).toBe(0.2);
  });

  it('két kulcskocka között LINEÁRISAN interpolál; a track a mintában kiürül', () => {
    const m = mask({ track: [frame({ time: 0, x: 0.2 }), frame({ time: 2, x: 0.6 })] });
    const mid = sampleMaskAt(m, 1); // félúton
    expect(mid.x).toBeCloseTo(0.4, 3);
    expect(mid.track).toBeUndefined();
  });

  it('a szélek előtt/után az első ill. utolsó keret tartva', () => {
    const m = mask({ track: [frame({ time: 1, x: 0.2 }), frame({ time: 3, x: 0.8 })] });
    expect(sampleMaskAt(m, 0).x).toBe(0.2); // első előtt
    expect(sampleMaskAt(m, 5).x).toBe(0.8); // utolsó után
  });
});

describe('kulcskocka-műveletek', () => {
  it('maskKeyframeTimes: rendezett időpontok', () => {
    expect(maskKeyframeTimes(mask({ track: [frame({ time: 3 }), frame({ time: 1 })] }))).toEqual([1, 3]);
  });

  it('addMaskKeyframe: beszúr t-nél a source geometriájából, EPS-en belül cserél', () => {
    let m = mask();
    m = addMaskKeyframe(m, 1, mask({ x: 0.3 }));
    expect(m.track).toHaveLength(1);
    m = addMaskKeyframe(m, 1.01, mask({ x: 0.9 })); // EPS-en belül → csere
    expect(m.track).toHaveLength(1);
    expect(m.track![0].x).toBe(0.9);
  });

  it('removeMaskKeyframeAt: töröl t közelében; üres track → undefined', () => {
    const m = mask({ track: [frame({ time: 1 })] });
    expect(removeMaskKeyframeAt(m, 1).track).toBeUndefined();
  });

  it('trackToPoints: minta-pozíciókból track, a poligon-pontokat az új középpontba tolja', () => {
    const m = mask({ points: [{ x: 0.5, y: 0.5 }], track: undefined });
    const out = trackToPoints(m, [{ time: 0, x: 0.6, y: 0.5 }]); // +0.1 x-ben
    expect(out.track).toHaveLength(1);
    expect(out.track![0].x).toBe(0.6);
    expect(out.track![0].points![0].x).toBeCloseTo(0.6, 3); // 0.5 + 0.1
  });
});
