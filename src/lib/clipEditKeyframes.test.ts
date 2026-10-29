import { cropKeyframes, sampleChannel, splitKeyframes } from '@/lib/keyframes';
import { createEmptyProject, cropClip, splitClip } from '@/lib/projectUtils';
import { buildDeleteRangePlan } from '@/lib/rangeEdit';
import type { AudioClip, Keyframe, Project, TextClip, VideoClip } from '@/types/project';

const kf = (time: number, value: number): Keyframe => ({ time, value, easing: 'linear' });

const audio: AudioClip = {
  id: 'a1',
  kind: 'audio',
  start: 2,
  duration: 10,
  uri: 'file:///a.m4a',
  label: 'Zene',
  trimIn: 1,
  sourceDuration: 20,
  volume: 1,
  keyframes: { volume: [kf(0, 0), kf(10, 1)], pan: [kf(4, -1), kf(8, 1)] },
} as AudioClip;

describe('vágás / trim: forrás-be-pont + kulcskockák minden fajtán (B1–B5)', () => {
  it('B1: a hang kettévágásakor a 2. fél trimIn-je a vágásig lép', () => {
    const [first, second] = splitClip(audio, 6)! as [AudioClip, AudioClip];
    expect(first.trimIn).toBe(1);
    expect(second.trimIn).toBe(5);
    expect(second.start).toBe(6);
    expect(second.duration).toBe(6);
  });

  it('B4: a hangerő- és pan-automáció a vágópontban folytonos, nem vész el', () => {
    const [first, second] = splitClip(audio, 6)! as [AudioClip, AudioClip];
    // az eredeti görbe a vágásnál (klip-relatív 4 mp): volume 0.4, pan -1
    expect(sampleChannel(first.keyframes!.volume, 4, 0)).toBeCloseTo(0.4);
    expect(sampleChannel(second.keyframes!.volume, 0, 0)).toBeCloseTo(0.4);
    expect(sampleChannel(second.keyframes!.volume, 4, 0)).toBeCloseTo(0.8);
    expect(second.keyframes!.pan).toBeDefined();
    expect(sampleChannel(second.keyframes!.pan, 2, 0)).toBeCloseTo(0);
  });

  it('B4: szöveg-klip kulcskockái is követik a vágást', () => {
    const text = { id: 't', kind: 'text', start: 0, duration: 4, text: 'x', keyframes: { opacity: [kf(0, 0), kf(4, 1)] } } as TextClip;
    const [, second] = splitClip(text, 2)! as [TextClip, TextClip];
    expect(sampleChannel(second.keyframes!.opacity, 0, 1)).toBeCloseTo(0.5);
  });

  it('B5: bal-trim (cropKeyframes from>0) — a görbe a tartalomhoz ragad', () => {
    const k = cropKeyframes(audio.keyframes, 3, 7)!;
    expect(sampleChannel(k.volume, 0, 0)).toBeCloseTo(0.3);
    expect(sampleChannel(k.volume, 7, 0)).toBeCloseTo(1);
    // balra nyújtás (from<0): minden kulcskocka később kerül
    const ext = cropKeyframes(audio.keyframes, -2, 12)!;
    expect(ext.volume![0].time).toBe(2);
  });

  it('splitKeyframes: két félre bont, a vég utáni első kulcskocka megmarad', () => {
    const [a, b] = splitKeyframes({ x: [kf(0, 0), kf(2, 1), kf(6, 0)] }, 3, 8);
    expect(a!.x!.map((k) => k.time)).toEqual([0, 2, 6]);
    expect(b!.x![0]).toMatchObject({ time: 0 });
    expect(sampleChannel(b!.x, 0, 0)).toBeCloseTo(0.75);
  });

  it('cropClip: ⏪ reversed videónál a bal darab trimIn-je a felső forrás-szakasz', () => {
    const v = { id: 'v', kind: 'video', start: 0, duration: 10, uri: 'u', trimIn: 2, sourceDuration: 30, speed: 1, volume: 1, reversed: true } as VideoClip;
    expect((cropClip(v, 0, 4) as VideoClip).trimIn).toBe(8);
    expect((cropClip(v, 4, 10) as VideoClip).trimIn).toBe(2);
  });

  it('B3: range-törlés a hang jobb szegmensét is a kivágás utáni tartalomra lépteti', () => {
    const base = createEmptyProject('x', '9:16');
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audio] } : t)) };
    const plan = buildDeleteRangePlan(p, 4, 7)!;
    const clips = plan.find((x) => x.trackType === 'music')!.clips as AudioClip[];
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ start: 2, duration: 2, trimIn: 1 });
    // jobb szegmens: idővonal 7→12 (forrás 6→11), 3 mp-cel balra csúszva
    expect(clips[1]).toMatchObject({ start: 4, duration: 5, trimIn: 6 });
    expect(clips[1].id).not.toBe('a1');
  });
});
