import {
  allPagesRendered,
  buildSlideshowProject,
  carouselImageUris,
  defaultShareMode,
  imageDocSources,
  renderedPages,
  unrenderedPages,
} from '@/lib/imageShare';
import { MAX_PROJECT_DURATION_SEC } from '@/lib/projectUtils';
import type { ImageClip, ImageDoc, Project } from '@/types/project';

const doc = (id: string, rendered?: string): ImageDoc =>
  ({
    id,
    name: id,
    aspectRatio: '1:1',
    layers: [{ kind: 'fill', id: `f-${id}`, fill: '#000' }],
    ...(rendered ? { renderedUri: rendered } : {}),
  }) as unknown as ImageDoc;

const project = (docs: ImageDoc[]): Project =>
  ({
    id: 'p1',
    name: 'Galéria',
    kind: 'image',
    aspectRatio: '1:1',
    fps: 30,
    tracks: [],
    assets: [],
    imageDocs: docs,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  }) as unknown as Project;

describe('imageShare — renderelt / rasterizálandó lapok', () => {
  const p = project([doc('a', 'file://a.png'), doc('b'), doc('c', 'file://c.png')]);
  it('renderedPages: csak amiknek van PNG-je', () => {
    expect(renderedPages(p).map((d) => d.id)).toEqual(['a', 'c']);
  });
  it('unrenderedPages: a hiányzók', () => {
    expect(unrenderedPages(p).map((d) => d.id)).toEqual(['b']);
  });
  it('allPagesRendered: csak ha MIND renderelt', () => {
    expect(allPagesRendered(p)).toBe(false);
    expect(allPagesRendered(project([doc('a', 'file://a.png')]))).toBe(true);
    expect(allPagesRendered(project([]))).toBe(false);
  });
});

describe('imageShare — carousel + mode', () => {
  it('carouselImageUris: a renderelt lapok URI-ja sorrendben', () => {
    expect(carouselImageUris(project([doc('a', 'file://a.png'), doc('b', 'file://b.png')]))).toEqual([
      'file://a.png',
      'file://b.png',
    ]);
  });
  it('defaultShareMode', () => {
    expect(defaultShareMode(1)).toBe('carousel');
    expect(defaultShareMode(3)).toBe('slideshow');
  });
  it('imageDocSources: {id, uri} a slideshow-maghoz', () => {
    expect(imageDocSources(project([doc('a', 'file://a.png')]))).toEqual([{ id: 'a', uri: 'file://a.png' }]);
  });
});

describe('buildSlideshowProject — diavetítés-projekt', () => {
  it('video-sáv a lapok ImageClip-jeivel (időzítve + átmenet), rendered ürítve', () => {
    const p = project([doc('a', 'file://a.png'), doc('b', 'file://b.png'), doc('c', 'file://c.png')]);
    const out = buildSlideshowProject(p, { perSlideSec: 2, transition: 'dissolve' })!;
    expect(out).not.toBeNull();
    expect(out.rendered).toBeUndefined();
    const vtrack = out.tracks.find((t) => t.type === 'video')!;
    const clips = vtrack.clips as ImageClip[];
    expect(clips).toHaveLength(3);
    expect(clips[0]).toMatchObject({ kind: 'image', uri: 'file://a.png', start: 0, duration: 2 });
    expect(clips[1].start).toBe(2);
    // átmenet a nem-utolsókon
    expect(clips[0].transitionOut?.type).toBe('dissolve');
    expect(clips[2].transitionOut).toBeUndefined();
  });

  it('opcionális háttérzene → music-sáv a teljes hosszra', () => {
    const p = project([doc('a', 'file://a.png'), doc('b', 'file://b.png')]);
    const out = buildSlideshowProject(p, { perSlideSec: 3, musicUri: 'file://song.m4a' })!;
    const mtrack = out.tracks.find((t) => t.type === 'music')!;
    expect(mtrack.clips).toHaveLength(1);
    expect(mtrack.clips[0]).toMatchObject({ kind: 'audio', uri: 'file://song.m4a', start: 0, duration: 6 });
  });

  it('auto-fit: sok lap → a per-slide a 10 perc-plafonba szorul', () => {
    const many = Array.from({ length: 300 }, (_, i) => doc(`d${i}`, `file://d${i}.png`));
    const out = buildSlideshowProject(project(many), { perSlideSec: 10 })!; // 300×10 = 3000s ≫ 600s
    const clips = out.tracks.find((t) => t.type === 'video')!.clips as ImageClip[];
    const total = clips.reduce((s, c) => s + c.duration, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROJECT_DURATION_SEC + 0.01);
  });

  it('renderelt lap nélkül → null', () => {
    expect(buildSlideshowProject(project([doc('a'), doc('b')]))).toBeNull();
  });
});
