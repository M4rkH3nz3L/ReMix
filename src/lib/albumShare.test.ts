import { albumTotalSec, buildAlbumVideoProject, canShareAlbum } from '@/lib/albumShare';
import type { AlbumDoc, AudioClip, ImageClip, ImageDoc, Project } from '@/types/project';

const song = (id: string, rendered?: string, dur = 0) => ({
  id,
  name: id,
  tracks: [],
  assets: [],
  ...(rendered ? { renderedUri: rendered, durationSec: dur } : {}),
});

const coverDoc = (id: string, rendered?: string): ImageDoc =>
  ({ id, name: 'Borító', aspectRatio: '1:1', layers: [], ...(rendered ? { renderedUri: rendered } : {}) }) as unknown as ImageDoc;

const project = (album?: AlbumDoc, imageDocs?: ImageDoc[]): Project =>
  ({
    id: 'p1',
    name: 'Album',
    kind: 'audio',
    aspectRatio: '1:1',
    fps: 30,
    tracks: [],
    assets: [],
    album,
    imageDocs,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  }) as unknown as Project;

describe('albumShare — megosztás-feltétel + össz-hossz', () => {
  it('albumTotalSec: csak a renderelt számok hossza', () => {
    const album: AlbumDoc = { songs: [song('a', 'file://a.m4a', 120), song('b'), song('c', 'file://c.m4a', 60)], activeSongId: 'a' };
    expect(albumTotalSec(project(album))).toBe(180);
  });

  it('canShareAlbum: kell borító (renderelt) + legalább egy renderelt szám', () => {
    const album: AlbumDoc = { songs: [song('a', 'file://a.m4a', 100)], activeSongId: 'a', coverDocId: 'cov' };
    expect(canShareAlbum(project(album, [coverDoc('cov', 'file://cover.png')]))).toBe(true);
    // nincs borító-PNG
    expect(canShareAlbum(project(album, [coverDoc('cov')]))).toBe(false);
    // nincs renderelt szám
    const album2: AlbumDoc = { songs: [song('a')], activeSongId: 'a', coverDocId: 'cov' };
    expect(canShareAlbum(project(album2, [coverDoc('cov', 'file://cover.png')]))).toBe(false);
    // nincs album
    expect(canShareAlbum(project(undefined))).toBe(false);
  });
});

describe('buildAlbumVideoProject', () => {
  const album: AlbumDoc = {
    songs: [song('a', 'file://a.m4a', 120), song('b', 'file://b.m4a', 90), song('nope')],
    activeSongId: 'a',
    coverDocId: 'cov',
  };

  it('borító EGY video-klip a teljes hosszra + a számok egymás után a music-sávon', () => {
    const out = buildAlbumVideoProject(project(album, [coverDoc('cov', 'file://cover.png')]))!;
    expect(out).not.toBeNull();
    expect(out.rendered).toBeUndefined();
    const vclip = out.tracks.find((t) => t.type === 'video')!.clips[0] as ImageClip;
    expect(vclip).toMatchObject({ kind: 'image', uri: 'file://cover.png', start: 0, duration: 210 }); // 120+90
    const aclips = out.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
    expect(aclips).toHaveLength(2); // a 'nope' (nem renderelt) kimarad
    expect(aclips[0]).toMatchObject({ uri: 'file://a.m4a', start: 0, duration: 120 });
    expect(aclips[1]).toMatchObject({ uri: 'file://b.m4a', start: 120, duration: 90 });
  });

  it('borító nélkül / renderelt szám nélkül → null', () => {
    expect(buildAlbumVideoProject(project(album, [coverDoc('cov')]))).toBeNull(); // nincs borító-PNG
    const noSong: AlbumDoc = { songs: [song('a')], activeSongId: 'a', coverDocId: 'cov' };
    expect(buildAlbumVideoProject(project(noSong, [coverDoc('cov', 'file://cover.png')]))).toBeNull();
    expect(buildAlbumVideoProject(project(undefined))).toBeNull();
  });
});
