import {
  buildBeatSplitPlan,
  buildRangeCutPlan,
  buildSceneSplitPlan,
  timelineBeats,
} from '@/lib/cutplan';
import type { AudioClip, Clip, Project, VideoClip } from '@/types/project';

// ✂️ Auto-vágás tervezők (csend/jelenet/beat → ripple/split kliplista) pure
// regressziós pajzsa. A tényleges vágás a command-buson fut.

const vclip = (over: Partial<VideoClip>): VideoClip =>
  ({
    id: 'c', kind: 'video', start: 0, duration: 10, uri: 'v', trimIn: 0, speed: 1,
    sourceDuration: 10, volume: 1, filterId: 'none',
    ...(over as object),
  } as VideoClip);

const project = (clips: Clip[]): Project =>
  ({
    id: 'p', name: 'T', aspectRatio: '9:16', fps: 30,
    tracks: [{ id: 't-v', type: 'video', name: 'v', clips }],
    assets: [], createdAt: '', updatedAt: '', schemaVersion: 6,
  } as unknown as Project);

describe('buildRangeCutPlan — forrás-tartományok ripple-kivágása', () => {
  it('a középső tartomány kiesik, a két megmaradt darab hézag nélkül csúszik össze', () => {
    const plan = buildRangeCutPlan(project([vclip({})]), new Map([['v', [{ start: 4, end: 6 }]]]), 0)!;
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ trimIn: 0, duration: 4, start: 0 });
    expect(plan.clips[1]).toMatchObject({ trimIn: 6, duration: 4, start: 4 }); // ripple: nincs hézag
    expect(plan.removedSeconds).toBeCloseTo(2, 2);
    expect(plan.cuts).toBe(1);
  });

  it('nincs érdemi vágnivaló → null', () => {
    expect(buildRangeCutPlan(project([vclip({})]), new Map(), 0)).toBeNull();
  });
});

describe('buildSceneSplitPlan — jelenetvágás (nem ripple)', () => {
  it('a forrás-idejű jelenetváltásnál felvág, a darabok a helyükön maradnak', () => {
    const plan = buildSceneSplitPlan(project([vclip({})]), new Map([['v', [3]]]))!;
    expect(plan.splits).toBe(1);
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ trimIn: 0, duration: 3, start: 0 });
    expect(plan.clips[1]).toMatchObject({ trimIn: 3, duration: 7, start: 3 });
  });

  it('nincs belső váltás → null', () => {
    expect(buildSceneSplitPlan(project([vclip({})]), new Map([['v', []]]))).toBeNull();
  });
});

describe('timelineBeats — a zeneklip beatjei idővonal-időben, az ablakra szűkítve', () => {
  it('eltolja a klip kezdetével + az ablakon kívülit eldobja', () => {
    const audio = { id: 'a', kind: 'audio', start: 2, duration: 5, uri: 'm', label: 'm', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip;
    expect(timelineBeats(audio, [1, 3, 6])).toEqual([3, 5]); // +2 → 3,5,8 ; <7 és >2 → 3,5
  });
});

describe('buildBeatSplitPlan — beat-vágás', () => {
  it('a megadott idővonal-időpontokon felvág', () => {
    const plan = buildBeatSplitPlan(project([vclip({})]), [3, 6])!;
    expect(plan.splits).toBe(2);
    expect(plan.clips).toHaveLength(3);
  });

  it('nincs érvényes vágáspont → null', () => {
    expect(buildBeatSplitPlan(project([vclip({})]), [])).toBeNull();
  });
});
