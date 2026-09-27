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
    expect(vid.remixOf).toEqual({ projectId: 'aud1', name: 'Podcast' });
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
