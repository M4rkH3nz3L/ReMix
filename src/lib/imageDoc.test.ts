import {
  addLayer,
  assignLayerToGroup,
  createGroup,
  createImageDoc,
  docBackground,
  docMediaUris,
  duplicateLayer,
  groupMembers,
  removeLayer,
  reorderLayer,
  setBackground,
  toggleLayerHidden,
  ungroup,
  updateGroup,
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

describe('🗂️ réteg-csoportok (lapos groupId)', () => {
  it('createGroup: groupId-t tesz a tagokra + csoport-rekord + összefüggő blokk', () => {
    const base = doc([fill('a'), photo('b', 'u'), fill('c'), photo('d', 'u')]);
    const g = createGroup(base, ['b', 'd'], 'grp1', 'Mappa');
    expect(g.groups).toEqual([{ id: 'grp1', name: 'Mappa' }]);
    expect(groupMembers(g, 'grp1').map((l) => l.id)).toEqual(['b', 'd']);
    // b és d összefüggő blokkba kerül az ELSŐ tag (b, idx1) helyén → a,b,d,c
    expect(g.layers.map((l) => l.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('assignLayerToGroup: hozzáad + a tag a blokk mellé kerül; undefined → kivesz', () => {
    const base = createGroup(doc([fill('a'), fill('b'), fill('c')]), ['a'], 'g', 'G');
    const added = assignLayerToGroup(base, 'c', 'g');
    expect(groupMembers(added, 'g').map((l) => l.id).sort()).toEqual(['a', 'c']);
    const removed = assignLayerToGroup(added, 'c', undefined);
    expect(removed.layers.find((l) => l.id === 'c')?.groupId).toBeUndefined();
  });

  it('ungroup: törli a tagok groupId-ját + a csoport-rekordot', () => {
    const base = createGroup(doc([fill('a'), fill('b')]), ['a', 'b'], 'g', 'G');
    const out = ungroup(base, 'g');
    expect(out.groups).toEqual([]);
    expect(out.layers.every((l) => l.groupId === undefined)).toBe(true);
  });

  it('updateGroup: mezők módosítása (rejtés/opacity/név)', () => {
    const base = createGroup(doc([fill('a')]), ['a'], 'g', 'G');
    const out = updateGroup(base, 'g', { hidden: true, opacity: 0.5, name: 'Új' });
    expect(out.groups?.[0]).toEqual({ id: 'g', name: 'Új', hidden: true, opacity: 0.5 });
  });
});
