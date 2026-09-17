import { buildPreComposePlan } from '@/lib/preCompose';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

const vid = (o: { id: string; start: number; duration: number; uri?: string }): VideoClip =>
  ({
    kind: 'video',
    uri: o.uri ?? 'file:///x.mp4',
    volume: 1,
    speed: 1,
    trimIn: 0,
    sourceDuration: 600,
    ...o,
  }) as unknown as VideoClip;

const text = (o: { id: string; start: number; duration: number }): Clip =>
  ({ kind: 'text', text: 'x', ...o }) as unknown as Clip;

const track = (type: TrackType, clips: Clip[]): Track =>
  ({ id: `t-${type}`, type, name: type, clips }) as unknown as Track;

const proj = (tracks: Track[]): Project =>
  ({ id: 'p', aspectRatio: '9:16', assets: [{ id: 'as1' }], tracks }) as unknown as Project;

/** a `comp` mező típusa nincs kiexportálva — a teszthez elég ez a szűk nézet */
type Compound = VideoClip & {
  comp: { duration: number; aspectRatio: string; assets: unknown[]; tracks: Track[] };
};

describe('preCompose — kijelölt klipek beágyazott kompozícióba zárása', () => {
  const p = proj([
    track('video', [
      vid({ id: 'v1', start: 2, duration: 3 }),
      vid({ id: 'v2', start: 5, duration: 2 }),
      vid({ id: 'keep', start: 20, duration: 2 }),
    ]),
    track('text', [text({ id: 'x1', start: 3, duration: 1 })]),
    track('music', [vid({ id: 'a1', start: 0, duration: 30 })]),
  ]);

  it('a compound a csoport helyét és teljes hosszát veszi fel', () => {
    const plan = buildPreComposePlan(p, ['v1', 'v2', 'x1']);
    expect(plan?.compound.start).toBeCloseTo(2, 6); // a legkorábbi kezdet
    expect(plan?.compound.duration).toBeCloseTo(5, 6); // 2..7
    expect(plan?.count).toBe(3);
  });

  it('a becsomagolt klipek a kompozíción BELÜL 0-hoz igazodnak', () => {
    const plan = buildPreComposePlan(p, ['v1', 'v2', 'x1']);
    const comp = (plan!.compound as Compound).comp;
    const inner = comp.tracks.flatMap((t) => t.clips);
    expect(inner.find((c) => c.id === 'v1')?.start).toBeCloseTo(0, 6); // 2 − 2
    expect(inner.find((c) => c.id === 'v2')?.start).toBeCloseTo(3, 6); // 5 − 2
    expect(inner.find((c) => c.id === 'x1')?.start).toBeCloseTo(1, 6); // 3 − 2
  });

  it('a kompozíción belül a klipek FAJTÁNKÉNT külön sávra kerülnek', () => {
    const plan = buildPreComposePlan(p, ['v1', 'v2', 'x1']);
    const comp = (plan!.compound as Compound).comp;
    const types = comp.tracks.map((t) => t.type).sort();
    expect(types).toEqual(['text', 'video']);
    expect(comp.tracks.find((t) => t.type === 'video')?.clips).toHaveLength(2);
  });

  it('a kompozíció örökli a projekt arányát és asset-listáját (önállóan renderelhető)', () => {
    const comp = (buildPreComposePlan(p, ['v1'])!.compound as Compound).comp;
    expect(comp.aspectRatio).toBe('9:16');
    expect(comp.assets).toHaveLength(1);
    expect(comp.duration).toBeCloseTo(3, 6);
  });

  it('az eredeti klipek eltűnnek a sávjaikról, a NEM kijelöltek maradnak', () => {
    const plan = buildPreComposePlan(p, ['v1', 'v2', 'x1']);
    const videoOut = plan!.tracks.find((t) => t.trackType === 'video')!.clips;
    expect(videoOut.map((c) => c.id)).toEqual(['keep', plan!.compound.id]);
    expect(plan!.tracks.find((t) => t.trackType === 'text')!.clips).toHaveLength(0);
  });

  it('csak az ÉRINTETT sávokat írja (+ a videó-sávot, ahová a compound kerül)', () => {
    const plan = buildPreComposePlan(p, ['x1']);
    const types = plan!.tracks.map((t) => t.trackType).sort();
    expect(types).toEqual(['text', 'video']); // a music sáv érintetlen
  });

  it('a compound előnézeti uri-ja az első média-klip forrása', () => {
    const plan = buildPreComposePlan(p, ['x1', 'v2']);
    expect((plan!.compound as VideoClip).uri).toBe('file:///x.mp4');
  });

  it('csak nem-média kijelölésnél üres uri (nem dob, nem talál ki forrást)', () => {
    const plan = buildPreComposePlan(p, ['x1']);
    expect((plan!.compound as VideoClip).uri).toBe('');
  });

  it('üres kijelölés / ismeretlen id → null', () => {
    expect(buildPreComposePlan(p, [])).toBeNull();
    expect(buildPreComposePlan(p, ['nincs-ilyen'])).toBeNull();
  });

  it('nem mutálja a bemeneti projektet', () => {
    const before = JSON.stringify(p);
    buildPreComposePlan(p, ['v1', 'v2', 'x1']);
    expect(JSON.stringify(p)).toBe(before);
  });
});
