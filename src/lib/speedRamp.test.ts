import { buildSpeedRampPieces, buildSpeedRampPlan, resolveCurve } from '@/lib/speedRamp';
import type { Clip, Project, VideoClip } from '@/types/project';

// 🚀 Speed ramping (preset-görbe → lépcsős sebességű darabok) pure pajzsa.
// KULCS-INVARIÁNS: a darabok össz-idővonalhossza = az eredeti klip-hossz
// (a többi sáv NEM csúszik).

let n = 0;
const makeId = () => `p${n++}`;
beforeEach(() => { n = 0; });

const vclip = (over: Partial<VideoClip> = {}): VideoClip =>
  ({ id: 'a', kind: 'video', start: 0, duration: 6, uri: 'v', trimIn: 0, speed: 1, sourceDuration: 20, volume: 1, filterId: 'none', ...(over as object) } as VideoClip);

describe('resolveCurve', () => {
  it('preset → a görbéje; egyéni tömb → tisztítva/clampelve; <2 → null', () => {
    expect(resolveCurve('hero')).toEqual([1.6, 1.2, 0.45, 0.45, 1.2, 1.6]);
    expect(resolveCurve([2, 0.5])).toEqual([2, 0.5]);
    expect(resolveCurve([NaN, -1, 2, 3])).toEqual([2, 3]); // hibás elemek kiesnek
    expect(resolveCurve([1])).toBeNull();
  });
});

describe('buildSpeedRampPieces', () => {
  it('a darabok össz-hossza PONTOSAN az eredeti (idővonal-hossz megőrzés)', () => {
    const pieces = buildSpeedRampPieces(vclip({ duration: 6 }), 'montage', makeId)!;
    expect(pieces).toHaveLength(5); // montage = 5 szegmens
    const total = pieces.reduce((s, p) => s + p.duration, 0);
    expect(total).toBeCloseTo(6, 3);
    // a trimIn egyenlő forrás-szakaszonként halad
    expect(pieces[0].trimIn).toBe(0);
    expect(pieces[1].trimIn).toBeGreaterThan(0);
  });

  it('túl rövid klip → null', () => {
    expect(buildSpeedRampPieces(vclip({ duration: 0.5 }), 'hero', makeId)).toBeNull();
  });
});

describe('buildSpeedRampPlan', () => {
  it('a rampelt klip helyére a darabjait teszi a sávon', () => {
    const project = {
      id: 'p', name: 'T', aspectRatio: '9:16', fps: 30,
      tracks: [{ id: 't', type: 'video', name: 'v', clips: [vclip({ id: 'a', duration: 6 }), vclip({ id: 'b', start: 6, duration: 3 })] }],
      assets: [], createdAt: '', updatedAt: '', schemaVersion: 6,
    } as unknown as Project;
    const plan = buildSpeedRampPlan(project, 'a', 'montage', makeId)!;
    expect(plan.pieces).toBe(5);
    expect(plan.clips.length).toBe(6); // 5 darab + a 'b' klip
    expect((plan.clips as Clip[]).some((c) => c.id === 'b')).toBe(true);
  });

  it('ismeretlen/nem-videó → null', () => {
    const project = { tracks: [{ id: 't', type: 'video', name: 'v', clips: [vclip()] }] } as unknown as Project;
    expect(buildSpeedRampPlan(project, 'nope', 'hero', makeId)).toBeNull();
  });
});
