import {
  addLayer,
  createImageDoc,
  docBackground,
  docMediaUris,
  duplicateLayer,
  removeLayer,
  reorderLayer,
  setBackground,
  toggleLayerHidden,
  updateLayer,
  visibleLayers,
} from '@/lib/imageDoc';
import type { ImageDoc, ImageLayer } from '@/types/project';

// 🎨 Kép-dokumentum réteg-műveletek (Creative Canvas) pure pajzsa. A `layers`
// tömb ALULRÓL FÖLFELÉ (0 = leghátul). Minden művelet ÚJ dokumentumot ad.

let n = 0;
const makeId = () => `id${n++}`;
beforeEach(() => {
  n = 0;
});

const fill = (id: string, color = '#000'): ImageLayer => ({ kind: 'fill', id, fill: color } as ImageLayer);
const photo = (id: string, uri: string): ImageLayer => ({ kind: 'photo', id, uri } as ImageLayer);

const doc = (layers: ImageLayer[]): ImageDoc => ({ id: 'd', name: 'D', aspectRatio: '1:1', layers } as ImageDoc);

describe('createImageDoc', () => {
  it('alap háttér → egy fill-réteg legalul', () => {
    const d = createImageDoc('K', '1:1', makeId, { background: '#abcdef' });
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0]).toMatchObject({ kind: 'fill', fill: '#abcdef' });
  });
  it('transparent → nincs réteg (alfás kimenet)', () => {
    expect(createImageDoc('K', '1:1', makeId, { background: 'transparent' }).layers).toEqual([]);
  });
  it('width/height/format átadva (kerekítve)', () => {
    const d = createImageDoc('K', '1:1', makeId, { width: 1080.6, height: 1080, format: 'vector' });
    expect(d).toMatchObject({ width: 1081, height: 1080, format: 'vector' });
  });
});

describe('addLayer / removeLayer / updateLayer', () => {
  it('addLayer: legfelülre fűz + renderedUri ürül', () => {
    const d = addLayer({ ...doc([fill('a')]), renderedUri: 'x' }, photo('b', 'u'));
    expect(d.layers.map((l) => l.id)).toEqual(['a', 'b']);
    expect(d.renderedUri).toBeUndefined();
  });
  it('removeLayer: töröl; ismeretlen id → változatlan ref', () => {
    const base = doc([fill('a'), fill('b')]);
    expect(removeLayer(base, 'a').layers.map((l) => l.id)).toEqual(['b']);
    expect(removeLayer(base, 'nope')).toBe(base);
  });
  it('updateLayer: a megadott réteget patcheli; ismeretlen → változatlan ref', () => {
    const base = doc([fill('a', '#000')]);
    const d = updateLayer(base, 'a', { fill: '#fff' } as Partial<ImageLayer>);
    expect((d.layers[0] as { fill: string }).fill).toBe('#fff');
    expect(updateLayer(base, 'nope', {})).toBe(base);
  });
});

describe('docBackground / setBackground', () => {
  it('docBackground: alsó fill színe, vagy transparent ha nincs', () => {
    expect(docBackground(doc([fill('a', '#123456')]))).toBe('#123456');
    expect(docBackground(doc([photo('p', 'u')]))).toBe('transparent');
  });
  it('setBackground szín: átfesti az alsó fillt (gradient törlődik)', () => {
    const d = setBackground(doc([fill('a', '#000'), photo('p', 'u')]), '#ff0000', makeId);
    expect((d.layers[0] as { fill: string }).fill).toBe('#ff0000');
    expect(d.layers).toHaveLength(2);
  });
  it('setBackground szín fill nélkül: új fillt szúr LEGALULRA', () => {
    const d = setBackground(doc([photo('p', 'u')]), '#00ff00', makeId);
    expect(d.layers[0].kind).toBe('fill');
    expect(d.layers[1].id).toBe('p');
  });
  it('setBackground transparent: eltávolítja az alsó fillt; ha nincs → változatlan', () => {
    const withFill = doc([fill('a'), photo('p', 'u')]);
    expect(setBackground(withFill, 'transparent', makeId).layers.map((l) => l.id)).toEqual(['p']);
    const noFill = doc([photo('p', 'u')]);
    expect(setBackground(noFill, 'transparent', makeId)).toBe(noFill);
  });
});

describe('reorderLayer', () => {
  it('a rajzolási sorrendben mozgat; a szélen no-op; ismeretlen → változatlan', () => {
    const base = doc([fill('a'), photo('b', 'u'), photo('c', 'u')]);
    expect(reorderLayer(base, 'a', 1).layers.map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(reorderLayer(base, 'a', -1)).toBe(base); // már legalul
    expect(reorderLayer(base, 'nope', 1)).toBe(base);
  });
});

describe('toggleLayerHidden / duplicateLayer / visibleLayers', () => {
  it('toggleLayerHidden: ki-be kapcsol', () => {
    const d = toggleLayerHidden(doc([fill('a')]), 'a');
    expect((d.layers[0] as { hidden?: boolean }).hidden).toBe(true);
  });
  it('duplicateLayer: másolat KÖZVETLENÜL az eredeti fölé, új id-vel', () => {
    const d = duplicateLayer(doc([fill('a'), photo('b', 'u')]), 'a', makeId);
    expect(d.layers.map((l) => l.id)).toEqual(['a', 'id0', 'b']);
  });
  it('visibleLayers: a rejtett és a ~0 opacitású kimarad', () => {
    const base = doc([
      fill('a'),
      { ...photo('b', 'u'), hidden: true } as ImageLayer,
      { ...photo('c', 'u'), opacity: 0 } as ImageLayer,
    ]);
    expect(visibleLayers(base).map((l) => l.id)).toEqual(['a']);
  });
});

describe('docMediaUris', () => {
  it('a photo uri + shape imageUri, deduplikálva', () => {
    const base = doc([
      photo('a', 'file://1'),
      photo('b', 'file://1'), // duplikátum
      { kind: 'shape', id: 's', shape: 'rectangle', imageUri: 'file://logo' } as ImageLayer,
      { kind: 'shape', id: 's2', shape: 'rectangle' } as ImageLayer, // nincs imageUri
    ]);
    expect(docMediaUris(base).sort()).toEqual(['file://1', 'file://logo']);
  });
});
