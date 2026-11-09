import { audioRemixProject, canRemix, imageRemixProject, remixRoute } from '@/lib/imageRemix';
import type { FeedPost } from '@/types/social';

const post = (over: Partial<FeedPost>): FeedPost =>
  ({
    id: 'p1',
    title: 'Nyár',
    remixable: true,
    videoUri: null,
    aspectRatio: '1:1',
    creator: { displayName: 'Kata' },
    ...over,
  }) as FeedPost;

describe('kép-remix', () => {
  it('a kép-poszt remixelhető, a tiltott és a média nélküli nem', () => {
    expect(canRemix(post({ images: ['https://x/1.png'] }))).toBe(true);
    expect(canRemix(post({ videoUri: 'https://x/v.mp4' }))).toBe(true);
    expect(canRemix(post({ images: ['https://x/1.png'], remixable: false }))).toBe(false);
    expect(canRemix(post({ images: [] }))).toBe(false);
  });

  it('minden kép külön lap, sorrendben, egy fotóréteggel a háttér fölött', () => {
    const p = imageRemixProject(post({ images: ['https://x/1.png', 'https://x/2.png'] }));
    expect(p.kind).toBe('image');
    expect(p.imageDocs?.map((d) => d.layers.map((l) => l.kind))).toEqual([['fill', 'photo'], ['fill', 'photo']]);
    expect(p.imageDocs?.map((d) => (d.layers[1] as { uri: string }).uri)).toEqual(['https://x/1.png', 'https://x/2.png']);
    expect(new Set(p.imageDocs?.map((d) => d.id)).size).toBe(2);
  });

  it('megjegyzi a forrást, hogy az újraposztolás hozzá kötődjön', () => {
    const p = imageRemixProject(post({ images: ['u'], projectId: 'prj9' }));
    expect(p.remixOf).toEqual({ projectId: 'prj9', name: 'Kata', postId: 'p1' });
    expect(p.name).toBe('Remix – Nyár');
  });

  it('a kép-remix a képstúdióba, a videós a szerkesztőbe visz', () => {
    expect(remixRoute(post({ images: ['u'] }), 'x')).toBe('/studio/image/x');
    expect(remixRoute(post({ videoUri: 'v' }), 'x')).toBe('/editor/x');
  });
});

describe('🎵 hang-remix (R6)', () => {
  it('a hang-posztból hang-projekt: a kinyert hang egy klipként a zene-sávon, a forrás megjelölve', () => {
    let n = 0;
    const p = audioRemixProject(post({ id: 'p9', projectId: 'orig', videoUri: 'https://x/v.mp4', sourceKind: 'audio' }), { uri: 'file:///m/x_hang.m4a', duration: 42.5 }, (k) => `${k}_${++n}`);
    expect(p.kind).toBe('audio');
    const clips = p.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(1);
    expect(p.tracks.find((t) => t.type === 'music')!.clips[0]).toEqual(expect.objectContaining({ kind: 'audio', uri: 'file:///m/x_hang.m4a', duration: 42.5, sourceDuration: 42.5, trimIn: 0 }));
    expect(p.assets[0]).toEqual(expect.objectContaining({ kind: 'audio', uri: 'file:///m/x_hang.m4a', provider: 'local' }));
    expect(p.remixOf).toEqual({ projectId: 'orig', name: 'Kata', postId: 'p9' });
  });
  it('a hang-poszt remixe a Hang Stúdióba nyílik; a videó- és kép-posztoké változatlan', () => {
    expect(remixRoute(post({ sourceKind: 'audio', videoUri: 'https://x/v.mp4' }), 'r1')).toBe('/studio/audio/r1');
    expect(remixRoute(post({ videoUri: 'https://x/v.mp4' }), 'r1')).toBe('/editor/r1');
    expect(remixRoute(post({ images: ['https://x/1.png'] }), 'r1')).toBe('/studio/image/r1');
  });
});
