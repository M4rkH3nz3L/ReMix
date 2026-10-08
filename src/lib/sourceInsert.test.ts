import { buildSourceClip } from '@/lib/sourceInsert';
import type { Asset } from '@/types/project';

const asset = (kind: Asset['kind'], over: Partial<Asset> = {}): Asset => ({
  id: 'a1', kind, uri: `file:///x.${kind}`, provider: 'local', ...over,
});
let n = 0;
const makeId = () => `clip-${n++}`;

describe('buildSourceClip — forrás-asset → timeline-klip', () => {
  beforeEach(() => { n = 0; });

  it('videó → video-sáv, a forrás hosszával (vagy 5s alap)', () => {
    const r = buildSourceClip(asset('video', { duration: 12 }), 3, makeId)!;
    expect(r.trackType).toBe('video');
    expect(r.clip.kind).toBe('video');
    expect(r.clip.start).toBe(3);
    expect(r.clip.duration).toBe(12);
    const noDur = buildSourceClip(asset('video'), 0, makeId)!;
    expect(noDur.clip.duration).toBe(5); // alap
  });

  it('kép → video-sáv, 4s', () => {
    const r = buildSourceClip(asset('image'), 1, makeId)!;
    expect(r.trackType).toBe('video');
    expect(r.clip.kind).toBe('image');
    expect(r.clip.duration).toBe(4);
  });

  it('hang → music-sáv, a label az asset nevéből', () => {
    const r = buildSourceClip(asset('audio', { name: 'Zene', duration: 30 }), 2, makeId)!;
    expect(r.trackType).toBe('music');
    expect(r.clip.kind).toBe('audio');
    expect((r.clip as { label: string }).label).toBe('Zene');
    expect(r.clip.duration).toBe(30);
  });

  it('a start 0 alá nem mehet', () => {
    expect(buildSourceClip(asset('video'), -5, makeId)!.clip.start).toBe(0);
  });

  it('minden hívás ÚJ id-t ad', () => {
    const a = buildSourceClip(asset('video'), 0, makeId)!;
    const b = buildSourceClip(asset('video'), 0, makeId)!;
    expect(a.clip.id).not.toBe(b.clip.id);
  });
});
