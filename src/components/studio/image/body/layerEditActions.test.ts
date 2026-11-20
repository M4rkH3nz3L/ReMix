import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { createLayerEditActions, type LayerEditDeps } from '@/components/studio/image/body/layerEditActions';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer } from '@/types/project';

jest.mock('@/lib/media', () => ({ pickImage: jest.fn(async () => ({ uri: 'file:///picked.jpg' })) }));
jest.mock('@/lib/projectFolderClient', () => ({ projectMediaDir: () => 'file:///proj/' }));
jest.mock('@/store/brandStyleStore', () => ({
  copyBrandLogoInto: jest.fn((_dir: string, uri: string) => (uri === 'hianyzo' ? null : `file:///proj/${uri}`)),
  useBrandStyle: { getState: () => ({}) },
}));

/**
 * ➕ A réteg-szerkesztések (REFACTOR: az `ImageStudioBody`-ból kiemelve): beszúrás, helyőrző-kitöltés,
 * többes műveletek és a pixel-munka — melyik írás milyen undo-címkével — a jelenlegi viselkedés.
 */

const t = ((k: string) => k) as unknown as TFunction;
const a = { kind: 'shape', id: 'a', shape: 'rectangle', position: { x: 0.2, y: 0.2 }, w: 0.2, h: 0.2 } as unknown as ImageLayer;
const b = { kind: 'shape', id: 'b', shape: 'rectangle', position: { x: 0.7, y: 0.6 }, w: 0.2, h: 0.2 } as unknown as ImageLayer;
const ph = { kind: 'photo', id: 'ph', uri: '', placeholder: true, position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5 } as unknown as ImageLayer;
const doc: ImageDoc = { id: 'd', name: 'D', aspectRatio: '1:1', width: 1000, height: 1000, layers: [a, b, ph] } as ImageDoc;

function setup(over: Partial<LayerEditDeps> = {}, ms: Partial<LayerEditDeps['ms']> = {}) {
  const deps = {
    t,
    doc,
    commit: jest.fn(),
    setSelectedId: jest.fn(),
    setSheet: jest.fn(),
    addDocPage: jest.fn(),
    ms: { multiIds: null, setMultiIds: jest.fn(), pixelLayerId: null, setPixelOpen: jest.fn(), ...ms },
    ...over,
  } as LayerEditDeps;
  return { deps, api: createLayerEditActions(deps) };
}
const calls = (deps: LayerEditDeps) => (deps.commit as jest.Mock).mock.calls;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('beszúrás', () => {
  it('új réteg: szöveg/kitöltés „undoAddLayer”, fotó a galériából „undoAddPhoto” — mindkettő kijelölve', async () => {
    const { deps, api } = setup();
    api.add('text');
    api.add('photo');
    await flush();
    expect(calls(deps).map((c) => c[1])).toEqual(['studio.image.undoAddLayer', 'studio.image.undoAddPhoto']);
    const added = calls(deps)[1][0].layers[3];
    expect(added).toMatchObject({ kind: 'photo', uri: 'file:///picked.jpg' });
    expect((deps.setSelectedId as jest.Mock).mock.calls[1][0]).toBe(added.id);
  });
  it('forma-típus és forrás-kép: a lap bezárul; a nem-kép forrás nem kerül be', () => {
    const { deps, api } = setup();
    api.addShapeType('ellipse');
    api.insertSource({ id: 'as1', kind: 'image', uri: 'file:///src.png' } as never);
    api.insertSource({ id: 'as2', kind: 'audio', uri: 'file:///a.mp3' } as never);
    expect(calls(deps).map((c) => c[1])).toEqual(['studio.image.undoAddLayer', 'studio.image.undoAddPhoto']);
    expect(calls(deps)[0][0].layers[3]).toMatchObject({ kind: 'shape', shape: 'ellipse' });
    expect(calls(deps)[1][0].layers[3]).toMatchObject({ kind: 'photo', uri: 'file:///src.png', assetId: 'as1' });
    expect((deps.setSheet as jest.Mock).mock.calls).toEqual([[null], [null]]);
  });
  it('márka-logó: a projektbe másolva, „brand.logoInsert”; hiányzó fájlra figyelmeztetés', () => {
    const { deps, api } = setup();
    api.insertBrandLogo('logo.png');
    api.insertBrandLogo('hianyzo');
    expect(calls(deps).map((c) => c[1])).toEqual(['studio.image.brand.logoInsert']);
    expect(calls(deps)[0][0].layers[3]).toMatchObject({ kind: 'photo', uri: 'file:///proj/logo.png' });
    expect(Alert.alert).toHaveBeenCalledWith('studio.image.brand.logos', 'studio.image.brand.logoMissing');
  });
  it('doc nélkül semmi nem kerül be', () => {
    const { deps, api } = setup({ doc: null });
    api.add('text');
    api.addShapeType('rectangle');
    api.insertBrandLogo('logo.png');
    api.addVariantPage(100, 100, 'x');
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.addDocPage).not.toHaveBeenCalled();
  });
  it('variáns-lap: új lap a megadott méretben', () => {
    const { deps, api } = setup();
    api.addVariantPage(1080, 1920, 'Story');
    const page = (deps.addDocPage as jest.Mock).mock.calls[0][0] as ImageDoc;
    expect([page.width, page.height]).toEqual([1080, 1920]);
    expect(page.id).not.toBe('d');
  });
});

describe('helyőrző', () => {
  it('csak a helyőrző fotó tölthető: a kép a helyére kerül kitöltéssel, „undoAddPhoto”', () => {
    useEditorStore.setState({ project: { imageDocs: [doc] } as never });
    const { deps, api } = setup();
    expect(api.placeImage('a', 'file:///x.jpg')).toBe(false);
    expect(api.placeImage('nincs', 'file:///x.jpg')).toBe(false);
    expect(api.placeImage('ph', 'file:///x.jpg')).toBe(true);
    expect(calls(deps)).toHaveLength(1);
    expect(calls(deps)[0][1]).toBe('studio.image.undoAddPhoto');
    expect(calls(deps)[0][0].layers[2]).toMatchObject({ uri: 'file:///x.jpg', fit: 'cover', placeholder: undefined });
  });
  it('a galériából kitöltés ugyanazt az írást adja', async () => {
    useEditorStore.setState({ project: { imageDocs: [doc] } as never });
    const { deps, api } = setup();
    api.fillPlaceholder('ph');
    await flush();
    expect(calls(deps)[0][0].layers[2].uri).toBe('file:///picked.jpg');
  });
});

describe('többes kijelölés és pixel-munka', () => {
  it('törlés / duplikálás / csoport / igazítás — a címkék, és mikor zárul a többes mód', () => {
    const { deps, api } = setup({}, { multiIds: ['a', 'b'] });
    api.onMultiAction('duplicate');
    api.onMultiAction('left');
    api.onMultiAction('group');
    api.onMultiAction('delete');
    expect(calls(deps).map((c) => c[1])).toEqual(['studio.image.undoDuplicate', 'studio.image.multi.left', 'studio.image.multi.group', 'studio.image.undoDelete']);
    expect(calls(deps)[0][0].layers).toHaveLength(5);
    expect(calls(deps)[2][0].groups).toHaveLength(1);
    expect(calls(deps)[3][0].layers.map((l: ImageLayer) => l.id)).toEqual(['ph']);
    expect((deps.ms.setMultiIds as jest.Mock).mock.calls).toEqual([[null], [null]]);
  });
  it('többes mód nélkül semmi', () => {
    const { deps, api } = setup();
    api.onMultiAction('delete');
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it('pixel: a folytatott réteg frissül, különben új nyújtott fotó-réteg — „pixel.title”', () => {
    const art = { width: 16, height: 8 } as never;
    const upd = setup({}, { pixelLayerId: 'ph' });
    upd.api.onPixelDone(art, 'file:///px.png');
    expect(upd.deps.ms.setPixelOpen).toHaveBeenCalledWith(false);
    expect(calls(upd.deps)[0][0].layers[2]).toMatchObject({ uri: 'file:///px.png', pixelArt: art });
    expect(calls(upd.deps)[0][1]).toBe('studio.image.pixel.title');
    const neu = setup();
    neu.api.onPixelDone(art, 'file:///px.png');
    const added = calls(neu.deps)[0][0].layers[3];
    expect(added).toMatchObject({ kind: 'photo', name: 'studio.image.pixel.title', fit: 'stretch', position: { x: 0.5, y: 0.5 } });
    expect(neu.deps.setSelectedId).toHaveBeenCalledWith(added.id);
  });
});
