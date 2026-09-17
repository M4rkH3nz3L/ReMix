import { buildDeleteRangePlan } from '@/lib/rangeEdit';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

const vid = (o: {
  id: string;
  start: number;
  duration: number;
  trimIn?: number;
  speed?: number;
}): VideoClip =>
  ({
    kind: 'video',
    uri: 'file:///x.mp4',
    volume: 1,
    speed: o.speed ?? 1,
    trimIn: o.trimIn ?? 0,
    sourceDuration: 600,
    ...o,
  }) as unknown as VideoClip;

const text = (o: { id: string; start: number; duration: number }): Clip =>
  ({ kind: 'text', text: 'x', ...o }) as unknown as Clip;

const track = (type: TrackType, clips: Clip[]): Track =>
  ({ id: `t-${type}`, type, name: type, clips }) as unknown as Track;

const proj = (tracks: Track[]): Project =>
  ({ id: 'p', aspectRatio: '9:16', assets: [], tracks }) as unknown as Project;

const clipsOf = (plan: ReturnType<typeof buildDeleteRangePlan>, type: TrackType) =>
  plan?.find((p) => p.trackType === type)?.clips ?? [];

describe('rangeEdit — az in/out sáv kivágása (ripple delete over range)', () => {
  it('a range UTÁNI klipek pontosan a range hosszával csúsznak balra', () => {
    const p = proj([
      track('video', [
        vid({ id: 'a', start: 0, duration: 2 }),
        vid({ id: 'b', start: 5, duration: 3 }),
      ]),
    ]);
    const out = clipsOf(buildDeleteRangePlan(p, 2, 4), 'video');
    expect(out.find((c) => c.id === 'a')?.start).toBe(0); // előtte — érintetlen
    expect(out.find((c) => c.id === 'b')?.start).toBeCloseTo(3, 6); // 5 − 2
  });

  it('a range-be lógó klip két szegmensre esik, és a jobb ÚJ id-t kap', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10 })])]);
    const out = clipsOf(buildDeleteRangePlan(p, 3, 6), 'video');
    expect(out).toHaveLength(2);
    const [left, right] = out;
    expect(left.duration).toBeCloseTo(3, 6); // 0..3
    expect(right.start).toBeCloseTo(3, 6); // 6 − 3 span
    expect(right.duration).toBeCloseTo(4, 6); // 6..10
    expect(right.id).not.toBe(left.id); // különben ütköznének
  });

  it('a jobb szegmens forrás-be-pontja a KIVÁGOTT rész utáni tartalomra ugrik', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10, trimIn: 20 })])]);
    const right = clipsOf(buildDeleteRangePlan(p, 3, 6), 'video')[1] as VideoClip;
    expect(right.trimIn).toBeCloseTo(26, 6); // 20 + 6 mp forrás-idő
  });

  it('a forrás-ugrás a sebességgel skálázódik (2× → kétszer annyi forrás-idő)', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10, trimIn: 0, speed: 2 })])]);
    const right = clipsOf(buildDeleteRangePlan(p, 3, 6), 'video')[1] as VideoClip;
    expect(right.trimIn).toBeCloseTo(12, 6); // 6 idővonal-mp × 2
  });

  it('MIN_CLIP_DURATION alatti maradék-szegmens eldobódik (nincs szemét-klip)', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 5 })])]);
    // a range a klip belsejében kezdődik, de gyakorlatilag a végéig tart
    const out = clipsOf(buildDeleteRangePlan(p, 2, 4.99), 'video');
    expect(out).toHaveLength(1);
    expect(out[0].duration).toBeCloseTo(2, 6);
  });

  it('a teljesen a range-be eső klip NYOMTALANUL eltűnik', () => {
    const p = proj([
      track('video', [
        vid({ id: 'a', start: 0, duration: 2 }),
        vid({ id: 'b', start: 3, duration: 1 }), // 3..4 — teljesen benne
        vid({ id: 'c', start: 6, duration: 2 }),
      ]),
    ]);
    const out = clipsOf(buildDeleteRangePlan(p, 2.5, 5), 'video');
    expect(out.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('ZÁROLT sávot nem bánt (a lock tényleg véd)', () => {
    const p = proj([
      track('video', [vid({ id: 'v', start: 0, duration: 10 })]),
      track('text', [text({ id: 'x', start: 0, duration: 10 })]),
    ]);
    const plan = buildDeleteRangePlan(p, 3, 6, ['text']);
    expect(plan?.map((t) => t.trackType)).toEqual(['video']);
  });

  it('MINDEN nem zárolt sávon egyszerre vág (szinkronban maradnak)', () => {
    const p = proj([
      track('video', [vid({ id: 'v', start: 8, duration: 2 })]),
      track('text', [text({ id: 'x', start: 8, duration: 2 })]),
    ]);
    const plan = buildDeleteRangePlan(p, 3, 6);
    expect(clipsOf(plan, 'video')[0].start).toBeCloseTo(5, 6);
    expect(clipsOf(plan, 'text')[0].start).toBeCloseTo(5, 6);
  });

  it('túl rövid range → null (nem gyárt undo-lépést)', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10 })])]);
    expect(buildDeleteRangePlan(p, 3, 3.01)).toBeNull();
  });

  it('fordított range (out < in) → null', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10 })])]);
    expect(buildDeleteRangePlan(p, 6, 3)).toBeNull();
  });

  it('ha semmi nem változna (üres tartomány a tartalom mögött) → null', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 2 })])]);
    expect(buildDeleteRangePlan(p, 50, 60)).toBeNull();
  });

  it('nem mutálja a bemeneti projektet', () => {
    const p = proj([track('video', [vid({ id: 'a', start: 0, duration: 10, trimIn: 5 })])]);
    const before = JSON.stringify(p);
    buildDeleteRangePlan(p, 3, 6);
    expect(JSON.stringify(p)).toBe(before);
  });
});
