import { buildRangeCutPlan } from '@/lib/cutplan';
import { createEmptyProject } from '@/lib/projectUtils';
import { buildMultiRangeDeletePlan } from '@/lib/rangeEdit';
import type { AudioClip, Clip, Project, TextClip, VideoClip } from '@/types/project';

/** ✂️ PRO-VIDEO B16 — a csend-/szövegvágás MINDEN sávot együtt ripple-öl */

const video: VideoClip = { id: 'v', kind: 'video', start: 0, duration: 10, uri: 'file:///v.mp4', trimIn: 0, sourceDuration: 10, speed: 1, volume: 1 } as VideoClip;
const caption = (id: string, start: number): TextClip => ({ id, kind: 'text', start, duration: 1, text: id }) as TextClip;
const music: AudioClip = { id: 'm', kind: 'audio', start: 6, duration: 4, uri: 'file:///m.m4a', label: 'm', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip;

function proj(): Project {
  const p = createEmptyProject('x', '9:16');
  const by: Partial<Record<string, Clip[]>> = { video: [video], captions: [caption('c1', 1), caption('c2', 6)], music: [music] };
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: by[t.type] ?? t.clips })) };
}

describe('B16 — csend-vágás ripple minden sávon', () => {
  it('a vágásterv az eredeti idővonalon adja a kivágott szakaszokat', () => {
    const plan = buildRangeCutPlan(proj(), new Map([['file:///v.mp4', [{ start: 3, end: 5 }]]]))!;
    expect(plan.removedRanges).toEqual([{ start: 3, end: 5 }]);
  });

  it('a 3–5 mp-es csend után a felirat 2 mp-cel előbb jön, a zene folyamatos, csak tolódik', () => {
    const patches = buildMultiRangeDeletePlan(proj(), [{ start: 3, end: 5 }])!;
    const get = (type: string) => patches.find((p) => p.trackType === type)!.clips;
    expect(get('captions').map((c) => [c.id, c.start])).toEqual([['c1', 1], ['c2', 4]]);
    expect(get('music')).toEqual([{ ...music, start: 4 }]); // nem vágva, csak eltolva
    const v = get('video') as VideoClip[];
    expect(v.map((c) => [c.start, c.duration, c.trimIn])).toEqual([[0, 3, 0], [3, 5, 5]]);
  });

  it('zárolt sáv érintetlen; több tartomány hátulról előre', () => {
    const patches = buildMultiRangeDeletePlan(proj(), [{ start: 1.5, end: 2 }, { start: 3, end: 5 }], ['captions'])!;
    expect(patches.find((p) => p.trackType === 'captions')).toBeUndefined();
    const v = patches.find((p) => p.trackType === 'video')!.clips;
    expect(v.reduce((s, c) => s + c.duration, 0)).toBeCloseTo(7.5);
  });
});
