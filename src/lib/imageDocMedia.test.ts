import { applyCommand } from '@/lib/commands';
import { coalesceKey, shouldCoalesce } from '@/lib/historyCoalesce';
import { imageDocMediaRefs, relinkImageDocs, withImageDocAssets } from '@/lib/imageDocMedia';
import type { ImageDoc, PhotoLayer, Project } from '@/types/project';

const photo = (id: string, uri: string, extra: Partial<PhotoLayer> = {}): PhotoLayer => ({
  kind: 'photo', id, uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover', ...extra,
});
const doc = (layers: ImageDoc['layers'], extra: Partial<ImageDoc> = {}): ImageDoc =>
  ({ id: 'd1', name: 'D', aspectRatio: '1:1', layers, ...extra }) as unknown as ImageDoc;
const project = (docs: ImageDoc[] = []): Project =>
  ({ id: 'p', assets: [], tracks: [], imageDocs: docs }) as unknown as Project;

describe('imageDocMedia (I2)', () => {
  it('a helyi fotó és LUT hivatkozás, a http nem', () => {
    const refs = imageDocMediaRefs(doc([photo('a', 'file:///a.jpg', { lut: 'file:///l.cube', lutName: 'L' }), photo('b', 'https://x/y.png')]));
    expect(refs.map((r) => [r.uri, r.role])).toEqual([['file:///a.jpg', 'photo'], ['file:///l.cube', 'lut']]);
  });

  it('a reducer assetként regisztrálja a rétegfájlt, ismétlés nélkül', () => {
    const d = doc([photo('a', 'file:///a.jpg')]);
    const once = applyCommand(project(), { type: 'UPSERT_IMAGE_DOC', doc: d })!;
    expect(once.assets).toHaveLength(1);
    expect(once.assets[0]).toMatchObject({ kind: 'image', uri: 'file:///a.jpg', provider: 'local' });
    const twice = withImageDocAssets(once, d);
    expect(twice).toBe(once);
  });

  it('a LUT asset `lut` szerepet kap', () => {
    const p = withImageDocAssets(project(), doc([photo('a', 'https://x/y.png', { lut: 'file:///l.cube' })]));
    expect(p.assets[0].role).toBe('lut');
  });

  it('a relink a rétegeket és a LUT-ot is átírja', () => {
    const d = doc([photo('a', 'file:///old', { lut: 'file:///old' })]);
    const p = applyCommand(project([d]), { type: 'RELINK_URI', oldUri: 'file:///old', newUri: 'file:///new' })!;
    const l = p.imageDocs![0].layers[0] as PhotoLayer;
    expect([l.uri, l.lut]).toEqual(['file:///new', 'file:///new']);
    expect(relinkImageDocs(p.imageDocs, 'nincs', 'x')).toBe(p.imageDocs);
  });
});

describe('kép undo-összevonás (I5, I6)', () => {
  const a = photo('a', 'u', { opacity: 1 });
  const b = photo('b', 'u', { opacity: 1 });
  const base = project([doc([a, b])]);
  const key = (next: ImageDoc['layers'], label?: string, extra: Partial<ImageDoc> = {}) =>
    coalesceKey({ type: 'UPSERT_IMAGE_DOC', doc: doc(next, extra), label }, base);

  it('ugyanaz a réteg + mező = összevonható', () => {
    expect(key([{ ...a, opacity: 0.5 }, b])).toBe(key([{ ...a, opacity: 0.4 }, b]));
  });
  it('két különböző réteg mozgatása NEM vonódik össze', () => {
    expect(key([{ ...a, opacity: 0.5 }, b], 'm')).not.toBe(key([a, { ...b, opacity: 0.5 }], 'm'));
  });
  it('különböző mező (opacity vs. pozíció) NEM vonódik össze', () => {
    expect(key([{ ...a, opacity: 0.5 }, b])).not.toBe(key([{ ...a, position: { x: 0, y: 0 } }, b]));
  });
  it('törlés / hozzáadás mindig önálló lépés', () => {
    expect(key([a], 'del')).toBeNull();
    expect(key([a, b, photo('c', 'u')], 'add')).toBeNull();
    expect(shouldCoalesce({ key: null, at: 0 }, null, 1)).toBe(false);
  });
  it('a csoport-opacitás húzása egy lépés (doc-szintű kulcs)', () => {
    const k1 = key([a, b], 'group-opacity', { groups: [{ id: 'g', opacity: 0.5 }] } as unknown as Partial<ImageDoc>);
    const k2 = key([a, b], 'group-opacity', { groups: [{ id: 'g', opacity: 0.4 }] } as unknown as Partial<ImageDoc>);
    expect(k1).not.toBeNull();
    expect(k1).toBe(k2);
  });
});
