import { audioProjectToVideo } from '@/lib/audioToVideo';
import type { Project } from '@/types/project';

const audioProject = (): Project =>
  ({
    id: 'aud1',
    name: 'Podcast',
    kind: 'audio',
    aspectRatio: '9:16',
    tracks: [
      { id: 't-music', type: 'music', name: 'Music', clips: [{ id: 'c1', kind: 'audio', start: 0, duration: 5 }] },
      { id: 't-vo', type: 'voiceover', name: 'VO', clips: [] },
    ],
    assets: [{ id: 'a1', kind: 'audio', uri: 'file:///x.mp3', provider: 'local' }],
    rendered: { uri: 'file:///out.mp4', renderedAt: '2026-01-01', durationSec: 5 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  }) as unknown as Project;

describe('audioProjectToVideo', () => {
  it('új, kind:video projekt — a hang-tartalom + assetek megmaradnak, ÚJ id', () => {
    const p = audioProject();
    const vid = audioProjectToVideo(p, 'Podcast (video)', '2026-02-02T00:00:00.000Z');

    expect(vid.kind).toBe('video');
    expect(vid.id).not.toBe(p.id);
    expect(vid.name).toBe('Podcast (video)');
    expect(vid.tracks).toEqual(p.tracks); // a hang-sávok (music/voiceover…) átkerülnek
    expect(vid.assets).toEqual(p.assets);
    expect(vid.remixOf).toBeUndefined(); // A46: a saját projekt nem remix-eredet
    expect(vid.rendered).toBeUndefined(); // a hang-kimenet NEM öröklődik
    expect(vid.createdAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('az EREDETI projektet nem módosítja', () => {
    const p = audioProject();
    audioProjectToVideo(p, 'x', '2026-02-02T00:00:00.000Z');
    expect(p.kind).toBe('audio');
    expect(p.rendered).toBeDefined();
  });
});

describe('audioProjectToVideo — csak a hang-tartalom megy át (A46)', () => {
  const full = (): Project =>
    ({
      ...audioProject(),
      remixOf: { projectId: 'other', name: 'Más alkotó dala', postId: 'p9' },
      album: { songs: [], activeSongId: 's1' },
      imageDocs: [{ id: 'cover' }],
      seo: { title: 'SEO', description: 'd', tags: [] },
      folder: 'Podcast',
      syncToRemix: true,
      coverAssetId: 'a1',
      live: { scenes: [] },
      bpm: 96,
      fps: 25,
      markers: [{ id: 'm1', time: 1, label: 'x' }],
      audioMaster: { target: 'podcast', lufs: -16, truePeak: -1.5, dynamics: 'balanced' },
      trackMix: { music: { gain: 0.5 } },
      links: [['c1', 'c2']],
    }) as unknown as Project;

  it('a hangprojekt identitása nem öröklődik (eredet, album, borító, mappa, közzététel)', () => {
    const vid = audioProjectToVideo(full(), 'Videó', '2026-02-02T00:00:00.000Z');
    for (const key of ['remixOf', 'album', 'imageDocs', 'seo', 'folder', 'syncToRemix', 'coverAssetId', 'live', 'rendered'] as const) {
      expect(vid[key]).toBeUndefined();
    }
  });

  it('a hang-tartalom és az időzítés átmegy', () => {
    const vid = audioProjectToVideo(full(), 'Videó', '2026-02-02T00:00:00.000Z');
    expect(vid).toMatchObject({ bpm: 96, fps: 25, aspectRatio: '9:16', trackMix: { music: { gain: 0.5 } }, links: [['c1', 'c2']] });
    expect(vid.audioMaster?.target).toBe('podcast');
    expect(vid.markers).toHaveLength(1);
  });
});

