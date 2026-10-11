import {
  buildRippleDeletePlan,
  buildRipplePlan,
  buildRippleResizePlan,
} from '@/lib/ripple';
import type { Clip, Project, Track, TrackType } from '@/types/project';

// 🧱 Core timeline-vágás (06 §2.5 ripple) regressziós pajzsa: a ripple a lyukat
// MINDEN nem-zárolt sávon bezárja/nyitja — egy elcsúszás a felirat/zene szinkront
// rontaná. A pure tervezőket (store-mentes) szögezzük le.

const vclip = (id: string, start: number, duration: number): Clip =>
  ({
    id, kind: 'audio', start, duration,
    uri: `file:///${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  } as Clip);

const track = (type: TrackType, clips: Clip[]): Track => ({ id: `trk-${type}`, type, name: type, clips });

const project = (tracks: Track[]): Project =>
  ({
    id: 'p', name: 'T', aspectRatio: '9:16', fps: 30, tracks, assets: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', schemaVersion: 6,
  } as Project);

const startsOf = (plan: { tracks: { trackType: TrackType; clips: Clip[] }[] }, type: TrackType) =>
  plan.tracks.find((t) => t.trackType === type)!.clips.map((c) => ({ id: c.id, start: c.start }));

describe('buildRipplePlan — a `from` utáni klipek eltolása minden sávon', () => {
  it('EPS alatti shift → null', () => {
    const p = project([track('video', [vclip('a', 0, 5)])]);
    expect(buildRipplePlan(p, 0, 0.0005)).toBeNull();
  });

  it('a from UTÁN kezdődők csúsznak, a korábbiak nem; 0 alá nem', () => {
    const p = project([
      track('video', [vclip('a', 0, 5), vclip('b', 5, 5), vclip('c', 10, 5)]),
    ]);
    const plan = buildRipplePlan(p, 5, 2)!;
    expect(startsOf(plan, 'video')).toEqual([
      { id: 'a', start: 0 }, // 0 < 5 → marad
      { id: 'b', start: 7 }, // 5 → 7
      { id: 'c', start: 12 }, // 10 → 12
    ]);
    expect(plan.moved).toBe(2);
    expect(plan.shift).toBe(2);
  });

  it('minden NEM-zárolt sávra hat; a zárolt kimarad', () => {
    const p = project([
      track('video', [vclip('v', 5, 5)]),
      track('music', [vclip('m', 5, 5)]),
    ]);
    const plan = buildRipplePlan(p, 0, 3, { lockedTracks: ['music'] })!;
    expect(plan.tracks.map((t) => t.trackType)).toEqual(['video']);
    expect(startsOf(plan, 'video')).toEqual([{ id: 'v', start: 8 }]);
  });

  it('skipClipIds: a kijelölt klip nem mozdul', () => {
    const p = project([track('video', [vclip('a', 0, 5), vclip('b', 5, 5)])]);
    const plan = buildRipplePlan(p, 0, 2, { skipClipIds: ['a'] })!;
    expect(startsOf(plan, 'video')).toEqual([{ id: 'a', start: 0 }, { id: 'b', start: 7 }]);
  });
});

describe('buildRippleDeletePlan — a lyuk bezárul', () => {
  it('ismeretlen id → null', () => {
    const p = project([track('video', [vclip('a', 0, 5)])]);
    expect(buildRippleDeletePlan(p, ['nope'])).toBeNull();
  });

  it('egy klip törlése: eltűnik + a mögötte lévők balra csúsznak a hosszával', () => {
    const p = project([
      track('video', [vclip('a', 0, 4), vclip('b', 4, 4), vclip('c', 8, 4)]),
    ]);
    const plan = buildRippleDeletePlan(p, ['b'])!; // from=4 to=8 shift=-4
    expect(startsOf(plan, 'video')).toEqual([{ id: 'a', start: 0 }, { id: 'c', start: 4 }]);
    expect(plan.shift).toBe(-4);
  });

  it('másik sáv felirata/zenéje is a kép után záródik (szinkron)', () => {
    const p = project([
      track('video', [vclip('a', 0, 4), vclip('b', 4, 4)]),
      track('music', [vclip('m', 8, 4)]),
    ]);
    const plan = buildRippleDeletePlan(p, ['b'])!; // to=8 shift=-4 → m: 8→4
    expect(startsOf(plan, 'music')).toEqual([{ id: 'm', start: 4 }]);
  });

  it('a zárolt sáv nem záródik', () => {
    const p = project([
      track('video', [vclip('a', 0, 4), vclip('b', 4, 4)]),
      track('music', [vclip('m', 8, 4)]),
    ]);
    const plan = buildRippleDeletePlan(p, ['b'], { lockedTracks: ['music'] })!;
    expect(plan.tracks.some((t) => t.trackType === 'music')).toBe(false);
  });
});

describe('buildRippleResizePlan — a klip új hossza + a mögöttiek csúsznak', () => {
  it('ismeretlen klip / nincs változás → null', () => {
    const p = project([track('video', [vclip('a', 0, 5)])]);
    expect(buildRippleResizePlan(p, 'nope', 3)).toBeNull();
    expect(buildRippleResizePlan(p, 'a', 5)).toBeNull(); // azonos hossz
  });

  it('növelés: a klip hosszabb lesz, a mögötte lévő jobbra csúszik a +delta-val', () => {
    const p = project([track('video', [vclip('a', 0, 4), vclip('b', 4, 4)])]);
    const plan = buildRippleResizePlan(p, 'a', 6)!; // shift +2
    expect(plan.shift).toBe(2);
    const clips = plan.tracks.find((t) => t.trackType === 'video')!.clips;
    expect(clips.find((c) => c.id === 'a')!.duration).toBe(6);
    expect(clips.find((c) => c.id === 'b')!.start).toBe(6); // 4 → 6
  });

  it('rövidítés: a mögötte lévő balra csúszik', () => {
    const p = project([track('video', [vclip('a', 0, 4), vclip('b', 4, 4)])]);
    const plan = buildRippleResizePlan(p, 'a', 2)!; // shift -2
    const clips = plan.tracks.find((t) => t.trackType === 'video')!.clips;
    expect(clips.find((c) => c.id === 'a')!.duration).toBe(2);
    expect(clips.find((c) => c.id === 'b')!.start).toBe(2); // 4 → 2
  });
});
