import { applyCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';
import { projectPreviewSource } from '@/lib/projectPreview';
import type { Asset, ImageDoc, Project } from '@/types/project';

const cover: Asset = { id: 'ast_cover', kind: 'image', uri: 'file:///p/cover.jpg', provider: 'local', name: 'cover' };

function imageDoc(id: string, extra: Partial<ImageDoc> = {}): ImageDoc {
  return {
    id,
    layers: [{ id: 'l1', kind: 'photo', uri: `file:///p/${id}-photo.jpg` }],
    ...extra,
  } as unknown as ImageDoc;
}

describe('projectPreviewSource', () => {
  it('a választott borító minden fajtánál elsőbbséget kap', () => {
    for (const kind of ['video', 'image', 'audio', 'model3d', 'live'] as const) {
      const p = applyCommand(createEmptyProject('x', '9:16', undefined, kind), { type: 'SET_PROJECT_COVER', asset: cover })!;
      expect(projectPreviewSource(p)).toEqual({ type: 'image', uri: cover.uri });
    }
  });

  it('3D: a szken poszter-képe; poszter nélkül null', () => {
    const p = createEmptyProject('m', '1:1', undefined, 'model3d');
    expect(projectPreviewSource(p)).toBeNull();
    const withPoster = { ...p, model3d: { ...(p.model3d ?? {}), poster: 'file:///p/poster.png' } } as Project;
    expect(projectPreviewSource(withPoster)).toEqual({ type: 'image', uri: 'file:///p/poster.png' });
  });

  it('kép: a renderelt lap, különben az első fotó-réteg', () => {
    const p = createEmptyProject('i', '1:1', undefined, 'image');
    expect(projectPreviewSource({ ...p, imageDocs: [imageDoc('d1')] })).toEqual({ type: 'image', uri: 'file:///p/d1-photo.jpg' });
    expect(projectPreviewSource({ ...p, imageDocs: [imageDoc('d1', { renderedUri: 'file:///p/r.png' })] })).toEqual({
      type: 'image',
      uri: 'file:///p/r.png',
    });
  });

  it('hang: az album borító-dokumentuma; album nélkül null (ikon)', () => {
    const p = createEmptyProject('a', '1:1', undefined, 'audio');
    expect(projectPreviewSource(p)).toBeNull();
    const withAlbum = {
      ...p,
      imageDocs: [imageDoc('other'), imageDoc('cov', { renderedUri: 'file:///p/album.png' })],
      album: { songs: [], activeSongId: 's1', coverDocId: 'cov' },
    } as Project;
    expect(projectPreviewSource(withAlbum)).toEqual({ type: 'image', uri: 'file:///p/album.png' });
  });

  it('videó: az első videóklip kockája (trimIn + 0.5 mp)', () => {
    const p = createEmptyProject('v', '9:16');
    const tracks = p.tracks.map((t) =>
      t.type === 'video'
        ? { ...t, clips: [{ id: 'c1', kind: 'video', start: 0, duration: 5, uri: 'file:///p/v.mp4', trimIn: 2, sourceDuration: 9, speed: 1, volume: 1, filterId: 'none' }] }
        : t
    ) as Project['tracks'];
    expect(projectPreviewSource({ ...p, tracks })).toEqual({ type: 'videoFrame', uri: 'file:///p/v.mp4', time: 2.5 });
  });
});

describe('SET_PROJECT_COVER', () => {
  it('beállítja, regisztrálja az assetet, a cserénél a régit kiveszi, null-ra eltávolítja', () => {
    const p0 = createEmptyProject('a', '1:1', undefined, 'audio');
    const p1 = applyCommand(p0, { type: 'SET_PROJECT_COVER', asset: cover })!;
    expect(p1.coverAssetId).toBe('ast_cover');
    expect(p1.assets.filter((a) => a.id === 'ast_cover')).toHaveLength(1);

    const next: Asset = { ...cover, id: 'ast_cover2', uri: 'file:///p/cover2.jpg' };
    const p2 = applyCommand(p1, { type: 'SET_PROJECT_COVER', asset: next })!;
    expect(p2.coverAssetId).toBe('ast_cover2');
    expect(p2.assets.map((a) => a.id)).toEqual(['ast_cover2']);

    const p3 = applyCommand(p2, { type: 'SET_PROJECT_COVER', asset: null })!;
    expect(p3.coverAssetId).toBeUndefined();
    expect(p3.assets).toHaveLength(0);
  });

  it('no-op: ugyanaz a borító, nem-kép asset, vagy eltávolítás borító nélkül', () => {
    const p0 = createEmptyProject('a', '1:1', undefined, 'audio');
    expect(applyCommand(p0, { type: 'SET_PROJECT_COVER', asset: null })).toBeNull();
    expect(applyCommand(p0, { type: 'SET_PROJECT_COVER', asset: { ...cover, kind: 'video' } })).toBeNull();
    const p1 = applyCommand(p0, { type: 'SET_PROJECT_COVER', asset: cover })!;
    expect(applyCommand(p1, { type: 'SET_PROJECT_COVER', asset: cover })).toBeNull();
  });
});
