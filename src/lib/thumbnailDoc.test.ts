import { applyCommand } from '@/lib/commands';
import { stillVersion } from '@/lib/linkedAsset';
import { projectPreviewSource } from '@/lib/projectPreview';
import { createEmptyProject, migrateProject, CURRENT_SCHEMA_VERSION } from '@/lib/projectUtils';
import { posterNeedsRefresh, thumbnailCanvas, thumbnailDoc, thumbnailDocOf, thumbnailFrameTimes } from '@/lib/thumbnailDoc';
import type { ImageDoc, Project, VideoClip } from '@/types/project';

let n = 0;
const ids = (p: string) => `${p}_${++n}`;

function video(): Project {
  const p = createEmptyProject('klip', '16:9', undefined, 'video');
  const clip = { kind: 'video', id: 'v1', start: 2, duration: 10, trimIn: 4, uri: 'file:///v.mp4', volume: 1 } as unknown as VideoClip;
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [clip] } : t)) };
}

describe('🖼️ CORE K5: szerkeszthető thumbnail', () => {
  it('a vászon a képarányon, a leghosszabb oldal 1280', () => {
    expect(thumbnailCanvas(16 / 9)).toEqual({ width: 1280, height: 720 });
    expect(thumbnailCanvas(9 / 16)).toEqual({ width: 720, height: 1280 });
    expect(thumbnailCanvas(1)).toEqual({ width: 1280, height: 1280 });
  });

  it('a kocka-jelöltek az első videóklip látható szakaszából (forrás-idő)', () => {
    const plan = thumbnailFrameTimes(video());
    expect(plan?.clip.id).toBe('v1');
    expect(plan?.times).toEqual([5.5, 7.5, 9.5, 11.5]); // trimIn 4 + 10 × 15/35/55/75 %
    expect(thumbnailFrameTimes(createEmptyProject('üres', '16:9', undefined, 'video'))).toBeNull();
  });

  it('a lap: a kocka teljes vásznon, a cím szerkeszthető szövegként; cím nélkül csak a kocka', () => {
    const d = thumbnailDoc({ id: 'th', name: 'Thumbnail', frameUri: 'file:///f.jpg', headline: ' Nagy cím ', aspect: 16 / 9, aspectRatio: '16:9', layerId: ids });
    expect(d.width).toBe(1280);
    expect(d.layers.map((l) => l.kind)).toEqual(['photo', 'text']);
    expect((d.layers[1] as { text: string }).text).toBe('Nagy cím');
    expect(thumbnailDoc({ id: 'th', name: 't', frameUri: 'u', headline: '', aspect: 1, aspectRatio: '1:1', layerId: ids }).layers).toHaveLength(1);
  });

  it('a lap egy köteggel a projektbe, a törlése a hivatkozást is viszi; ismeretlen lapra nem mutathat', () => {
    const d = thumbnailDoc({ id: 'th', name: 't', frameUri: 'file:///f.jpg', aspect: 16 / 9, aspectRatio: '16:9', layerId: ids });
    let p = applyCommand(video(), { type: 'UPSERT_IMAGE_DOC', doc: d })!;
    expect(applyCommand(p, { type: 'SET_THUMBNAIL_DOC', docId: 'nincs' })).toBeNull();
    p = applyCommand(p, { type: 'SET_THUMBNAIL_DOC', docId: 'th' })!;
    expect(thumbnailDocOf(p)?.id).toBe('th');
    expect(applyCommand(p, { type: 'SET_THUMBNAIL_DOC', docId: 'th' })).toBeNull();
    const removed = applyCommand(p, { type: 'REMOVE_IMAGE_DOC', docId: 'th' })!;
    expect(removed.thumbnailDocId).toBeUndefined();
    expect(applyCommand(p, { type: 'SET_THUMBNAIL_DOC', docId: null })!.thumbnailDocId).toBeUndefined();
  });

  it('az előnézet a thumbnail-lapból jön (a kifejezett borító elsőbbséget kap)', () => {
    const d = { ...thumbnailDoc({ id: 'th', name: 't', frameUri: 'file:///f.jpg', aspect: 16 / 9, aspectRatio: '16:9', layerId: ids }), thumbUri: 'file:///thumb.png' } as ImageDoc;
    const p = { ...video(), imageDocs: [d], thumbnailDocId: 'th' };
    expect(projectPreviewSource(p)).toEqual({ type: 'image', uri: 'file:///thumb.png' });
    const noRender = { ...p, imageDocs: [{ ...d, thumbUri: undefined }] };
    expect(projectPreviewSource(noRender)).toEqual({ type: 'image', uri: 'file:///f.jpg' });
  });

  it('a fotó nélküli kép- és design-lapnak is van előnézete (az élő bélyegkép)', () => {
    const doc = { id: 'd', name: 'd', aspectRatio: '16:9', width: 1280, height: 720, layers: [{ id: 't', kind: 'text', text: 'A' }], thumbUri: 'file:///t.png' } as unknown as ImageDoc;
    for (const kind of ['image', 'design'] as const) {
      const p = { ...createEmptyProject('x', '16:9', undefined, kind), imageDocs: [doc] };
      expect(projectPreviewSource(p)).toEqual({ type: 'image', uri: 'file:///t.png' });
    }
  });

  it('a feed-poszter akkor frissül, ha a lap változott (a poszter a lap verziójával mentődik)', () => {
    const d = thumbnailDoc({ id: 'th', name: 't', frameUri: 'file:///f.jpg', headline: 'A', aspect: 1, aspectRatio: '1:1', layerId: ids });
    const v = stillVersion(d);
    expect(posterNeedsRefresh({ url: 'https://x/v.mp4' }, d)).toBe(true);
    expect(posterNeedsRefresh({ url: 'https://x/v.mp4', posterUrl: 'p', posterKey: v }, d)).toBe(false);
    const edited = { ...d, layers: [d.layers[0], { ...d.layers[1], text: 'B' }] } as ImageDoc;
    expect(posterNeedsRefresh({ url: 'https://x/v.mp4', posterUrl: 'p', posterKey: v }, edited)).toBe(true);
    expect(posterNeedsRefresh({ url: 'https://x/v.mp4', posterUrl: 'p' }, null)).toBe(false);
    expect(posterNeedsRefresh(undefined, d)).toBe(false);
  });

  it('séma v9: a régi projekt migrálódik, a mezők opcionálisak', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
    expect(migrateProject({ ...video(), schemaVersion: 8 }).schemaVersion).toBe(9);
  });
});
