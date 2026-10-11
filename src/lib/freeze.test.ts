import { buildFreezePlan } from '@/lib/freeze';
import type { Clip, ImageClip, Project, TrackType, VideoClip } from '@/types/project';

// ❄️ Freeze / hold frame (állókocka-beszúrás + ripple; a hang átível) pure pajzsa.

const vclip = (id: string, start: number, duration: number): VideoClip =>
  ({ id, kind: 'video', start, duration, uri: 'v', trimIn: 0, speed: 1, sourceDuration: 20, volume: 1, filterId: 'none' } as VideoClip);

const aclip = (id: string, start: number, duration: number): Clip =>
  ({ id, kind: 'audio', start, duration, uri: 'm', label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as Clip);

const still: ImageClip = { id: 'still', kind: 'image', start: 0, duration: 2, uri: 'frame.png', filterId: 'none' } as ImageClip;

const project = (video: Clip[], music: Clip[]): Project =>
  ({
    id: 'p', name: 'T', aspectRatio: '9:16', fps: 30,
    tracks: [
      { id: 't-v', type: 'video' as TrackType, name: 'v', clips: video },
      { id: 't-m', type: 'music' as TrackType, name: 'm', clips: music },
    ],
    assets: [], createdAt: '', updatedAt: '', schemaVersion: 6,
  } as unknown as Project);

const startsOf = (plan: { tracks: { trackType: TrackType; clips: Clip[] }[] }, type: TrackType) =>
  plan.tracks.find((t) => t.trackType === type)!.clips.map((c) => ({ id: c.id, start: c.start }));

describe('buildFreezePlan', () => {
  it('a videóklipet kettévágja, állókockát szúr be, és a time utániakat +duration-nel tolja', () => {
    const plan = buildFreezePlan(project([vclip('a', 0, 10)], []), 'a', 4, 2, still)!;
    const v = startsOf(plan, 'video');
    expect(v.map((c) => c.start)).toEqual([0, 4, 6]); // before(0..4), still(4..6), after(6..12)
    expect(v[1].id).toBe('still');
  });

  it('a time-ot ÁTÍVELŐ hang NEM tolódik (a kép áll, a hang szól), a time utáni igen', () => {
    // m1 start2 átível a time=4-en → marad; m2 start5 > 4 → +2 → 7
    const plan = buildFreezePlan(
      project([vclip('a', 0, 10)], [aclip('m1', 2, 4), aclip('m2', 5, 3)]),
      'a', 4, 2, still
    )!;
    expect(startsOf(plan, 'music')).toEqual([{ id: 'm1', start: 2 }, { id: 'm2', start: 7 }]);
  });

  it('nem videó klip / ismeretlen → null', () => {
    expect(buildFreezePlan(project([vclip('a', 0, 10)], []), 'nope', 4, 2, still)).toBeNull();
  });
});
